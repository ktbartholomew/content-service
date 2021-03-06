// Handler functions for the /assets endpoint.

var
  async = require('async'),
  pkgcloud = require('pkgcloud'),
  fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  config = require('./config'),
  connection = require('./connection'),
  log = require('./logging').getLogger();

/**
 * @description Calculate a checksum of an uploaded file's contents to generate
 *   the fingerprinted asset name.
 */
function fingerprintAsset(asset, callback) {
  var
    sha256sum = crypto.createHash('sha256'),
    assetFile = fs.createReadStream(asset.path),
    chunks = [];

  assetFile.on('data', function (chunk) {
    sha256sum.update(chunk);
    chunks.push(chunk);
  });

  assetFile.on('error', callback);

  assetFile.on('end', function() {
    var
      digest = sha256sum.digest('hex'),
      ext = path.extname(asset.name),
      basename = path.basename(asset.name, ext),
      fingerprinted = basename + "-" + digest + ext;

    log.debug("Fingerprinted asset [" + asset.name + "] as [" + fingerprinted + "].");

    callback(null, {
      key: asset.key,
      original: asset.name,
      chunks: chunks,
      filename: fingerprinted,
      type: asset.type,
    });
  });
}

/**
 * @description Upload an asset's contents to the asset container.
 */
function publishAsset(asset, callback) {
  var up = connection.client.upload({
    container: config.assetContainer(),
    remote: asset.filename,
    contentType: asset.type,
    headers: { 'Access-Control-Allow-Origin': '*' }
  });

  up.on('error', callback);

  up.on('finish', function () {
    log.debug("Successfully uploaded asset [" + asset.filename + "].");

    var baseURI = connection.assetContainer.cdnSslUri;
    asset.publicURL = baseURI + '/' + encodeURIComponent(asset.filename);
    callback(null, asset);
  });

  asset.chunks.forEach(function (chunk) {
    up.write(chunk);
  });

  up.end();
}

/**
 * @description Give this asset a name. The final name and CDL URI of this
 *   asset will be included in all outgoing metadata envelopes, for use by
 *   layouts.
 */
function nameAsset(asset, callback) {
  log.debug("Naming asset [" + asset.original + "] as [" + asset.key + "].");

  connection.db.collection("layoutAssets").updateOne(
    { key: asset.key },
    { $set: { key: asset.key, publicURL: asset.publicURL } },
    { upsert: true },
    function (err) { callback(err, asset); }
  );
}

/**
 * @description Create and return a function that processes a single asset.
 */
function makeAssetHandler(should_name) {
  return function(asset, callback) {
    log.debug("Processing uploaded asset [" + asset.name + "].");

    var steps = [
      async.apply(fingerprintAsset, asset),
      publishAsset
    ];

    if (should_name) {
      steps.push(nameAsset);
    }

    async.waterfall(steps, callback);
  };
}

/**
 * @description Fingerprint and upload static, binary assets to the
 *   CDN-enabled ASSET_CONTAINER. Return a JSON object containing a
 *   map of the provided filenames to their final, public URLs.
 */
exports.accept = function (req, res, next) {
  var assetData = Object.getOwnPropertyNames(req.files).map(function (key) {
    var asset = req.files[key];
    asset.key = key;
    return asset;
  });

  log.info("(" + req.apikeyName + ") Accepting " + assetData.length + " asset(s).");

  async.map(assetData, makeAssetHandler(req.query.named), function (err, results) {
    if (err) {
      log.error("(" + req.apikeyName + ") Unable to process an asset.", err);

      res.send(500, {
        error: "(" + req.apikeyName + ") Unable to upload one or more assets!"
      });
      next();
    }

    var summary = {};
    results.forEach(function (result) {
      summary[result.original] = result.publicURL;
    });
    log.debug("(" + req.apikeyName + ") All assets have been processed succesfully.", summary);

    res.send(summary);
    next();
  });
};
