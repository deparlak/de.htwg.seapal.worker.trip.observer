var PouchDB = require('pouchdb');
var Worker = require('de.htwg.seapal.worker');
var nconf = require('nconf');

//
// Setup nconf to use (in-order):
//   1. Command-line arguments
//   2. Environment variables
//   3. A file located at 'path/to/config.json'
//
nconf.argv()
   .env()
   .file({ file: 'config.json' });

// get server connection setup
var server = nconf.get("server");
// set user object
var user = nconf.get("user");
// set noView object
var noView = nconf.get("noView");
// reference to pouchdb handle
var pouchdb;
// subscribe to this channels, by creating a processGeohash document.
var processGeohash = {};
processGeohash.owner = user.email;
processGeohash.type = 'processGeohash';
processGeohash._id = user.email + '/processGeohash';
processGeohash._rev = null;
processGeohash.channels = noView.channels;

// start new worker
var worker = new Worker(server, user, function(err, response) {
    if (err) {
        throw new Error(err);
    }
    // save pouchdb handle
    pouchdb = response;
   
    // fetch the latest doc, which will be updated on new data
    pouchdb.get(processGeohash._id, function(err, response) {
        // if we get an error, which is not because of a missing doc 
        // (missing doc is ok if it's the first created document by this user)
        if (err && err.status !== 404) {
            throw new Error(err);
        } else if (err && err.status === 404){
            processGeohash._rev = null;
        } else {
            processGeohash._rev = response._rev;
        }
    
        // update it now.
        pouchdb.put(processGeohash, function(err, response) {
            if (err) {
                console.log("Got error");
                console.log(err);
            } else {
                console.log("Set processGeohash successfully!");
            }
        });
    });   
});
