/*
 * Unit tests for API key management.
 */

require("./helpers/before");

var
  request = require("supertest"),
  expect = require("chai").expect,
  connection = require("../src/connection"),
  connmocks = require("./mock/connection"),
  authhelper = require("./helpers/auth"),
  config = require("../src/config"),
  server = require("../src/server");

describe("/keys", function () {
  var mocks;

  beforeEach(function () {
    mocks = connmocks.install(connection);
    authhelper.install();
  });

  describe("POST", function () {

    it("allows an admin to issue a new key", function (done) {
      request(server.create())
        .post("/keys?named=someone")
        .set("Authorization", 'deconst apikey="12345"')
        .expect(200)
        .expect("Content-Type", "application/json")
        .expect(function (res) {
          if (!("apikey" in res.body)) throw new Error("No API key issued");

          var
            apikey = res.body.apikey,
            found = false,
            issued = mocks.mockDB.collection("apiKeys").find().toArray();

          issued.forEach(function (each) {
            if (each.apikey === apikey && each.name === "someone") {
              found = true;
            }
          });

          if (!found) throw new Error("Issued API key not found in database");
        })
        .end(done);
    });

    it("requires a key name", function (done) {
      request(server.create())
        .post("/keys")
        .set("Authorization", 'deconst apikey="12345"')
        .expect(409)
        .expect({
          code: "MissingParameter",
          message: "You must specify a name for the API key"
        }, done);
    });

    it("requires authentication", function (done) {
      authhelper.ensureAuthIsRequired(
        request(server.create()).post("/keys?named=mine"),
        done);
    });

    it("prevents non-admins from issuing keys", function (done) {
      authhelper.ensureAdminIsRequired(
        request(server.create()).post("/keys?named=mine"),
        done);
    });
  });

  describe("DELETE", function () {

    it("allows an admin to revoke an existing key", function (done) {
      mocks.mockDB.collection("apiKeys").insertOne({ name: "torevoke", apikey: "54321" });

      request(server.create())
        .delete("/keys/54321")
        .set("Authorization", authhelper.AUTH_ADMIN)
        .expect(204)
        .expect(function () {
          var
            found = false,
            issued = mocks.mockDB.collection("apiKeys").find().toArray();

          for (var i = 0; i < issued.length; i++) {
            var each = issued[i];
            if (each.apikey === "54321" && each.name === "torevoke") {
              found = true;
            }
          }

          if (found) throw new Error("Revoked API key is still present in the database");
        })
        .end(done);
    });

    it("requires authentication", function (done) {
      authhelper.ensureAuthIsRequired(
        request(server.create()).delete("/keys/54321"),
        done);
    });

    it("prevents non-admins from revoking keys", function (done) {
      authhelper.ensureAdminIsRequired(
        request(server.create()).delete("/keys/54321"),
        done);
    });

    it("doesn't allow admins to revoke their own key", function (done) {
      request(server.create())
        .delete("/keys/" + authhelper.APIKEY_ADMIN)
        .set("Authorization", authhelper.AUTH_ADMIN)
        .expect(409)
        .expect("Content-Type", "application/json")
        .expect({ code: "InvalidArgument", message: "You cannot revoke your own API key." }, done);
    });
  });
});
