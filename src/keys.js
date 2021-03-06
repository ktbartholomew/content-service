// Issue and revoke API keys.

var
  crypto = require('crypto'),
  async = require('async'),
  restify = require('restify'),
  config = require('./config'),
  connection = require('./connection'),
  log = require('./logging').getLogger();

/**
 * @description Generate a fresh API key.
 */
function generateKey(callback) {
  crypto.randomBytes(128, function (err, buf) {
    if (err) return callback(err);

    callback(null, { apikey: buf.toString('hex')});
  });
}

/**
 * @description Store an API key in Mongo.
 */
function storeKey(name, result, callback) {
  var doc = { name: name, apikey: result.apikey };

  connection.db.collection("apiKeys").insertOne(doc, function (err) {
    if (err) return callback(err);

    callback(null, { apikey: result.apikey });
  });
}

/**
 * @description Remove an API key from Mongo.
 */
function removeKey(key, callback) {
  connection.db.collection("apiKeys").deleteOne({ apikey: key }, function (err) {
    if (err) return callback(err);

    callback(null);
  });
}

exports.issue = function(req, res, next) {
  var name = req.query.named;

  if (!name) {
    log.warn("Attempt to issue an API key without a name.");

    return next(new restify.MissingParameterError("You must specify a name for the API key"));
  }

  log.info("Issuing an API key for [" + name + "]");

  async.waterfall([
    generateKey,
    async.apply(storeKey, name)
  ], function (err, result) {
    next.ifError(err);

    res.json(200, { apikey: result.apikey });
    next();
  });
};

exports.revoke = function(req, res, next) {
  if (req.apikey === req.params.key) {
    log.warn("Attempt to revoke the admin key.");

    return next(new restify.InvalidArgumentError("You cannot revoke your own API key."));
  }

  log.info("Revoking an API key.");

  removeKey(req.params.key, function (err) {
    next.ifError(err);

    res.send(204);
    next();
  });
};
