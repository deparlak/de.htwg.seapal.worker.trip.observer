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
// reference to db
var db;

// start new worker
var worker = new Worker(server, user, function(err, response) {
    if (err) {
        console.log("GOT ERROR");
        console.log(err);
        return;
    }
    
    console.log("Observer is running");
    // save db handle
    db = response;
    // listen on db changes, to trigger document summarized on a update.
    db.changes({since : 'now', live : true})
        .on('change', function (info) {
            console.log(info);
        }).on('error', function (err) {
            console.log(err);
        });
});
