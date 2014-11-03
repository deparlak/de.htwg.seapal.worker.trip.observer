#Preconditions.
- [node.js v0.10.26](http://nodejs.org/download/)
- npm 1.4.3
- [Sync Gateway 1.0.2-9](http://www.couchbase.com/nosql-databases/downloads)
- [Seapal Webserver](https://github.com/deparlak/de.htwg.seapal.play)

#Description
This project is a node.js application, which aggregate boat positions of seapal users into
one document. This enable us to share the information about the position of each user
with each user. A Client does not need direct access to the view mechanism of couchbase. 

####Why do we not just use a view and ask the view directly by each user?
>The Sync Gateway does (currently) not support views. So we would need another Route on a Webserver to access the
Couchbase View directly. If we use another Route, we would also need a mechanism to avoid polling the view. The Sync Gateway
does use a Comet connection to each user, to notify a user about new/updated/removed documents. So the idea is to use
the available infrastructure, instead of creating another API.

####Why do we not use one channel, to which each user map his position document?
>The amount of documents which would be loaded to/from the Sync Gateway would be quadratic. E.g. we have 10 users. Each
user will send his position to the Sync Gateway. Afterwards each user has to download the position of the other users,
which would be 90 Documents (each user has to download 9 Documents). This approach would simply not scale on a rising
number of users.

####How does a bot server receive the documents (with the position of a user), which he need to aggregate to one document?
>There are two approaches implemented. The first one is using a view to get the information about the user positions. Because
the Sync Gateway does not support views, the bot server need to access the Couchbase Server Backend directly.
The second approach does not use a view and needs no access to the Couchbase Server Backend.

####How does the approach work with the use of a view?
>Each user create a document with his position. The position is saved as a [geohash](http://www.bigdatamodeling.org/2013/01/intuitive-geohash.html). On the Couchbase Server
we use a view, which emit the position document with the date of creation and the geohash as the key. 
Because of the use of the geohash in the key, we are able to query the view for different locations.
The bot server query the view cyclic and create a new document with all users of the queried geohash
location. With the use of the geohash, we are able to start different Bot Servers, which query the view
for different locations. If we have for example not many users, we could use only one Bot Server which query
the view to get all geohash locations. If the number of users are rising, we may require additional Bot Server which
query the views for different locations.

####How does the approach work without using a view?
>If a user create a document with his position, we map the geohash position to some channels in the Sync Function.
E.g. if the user position is on geohash "01234567bc", we map this document to up to 9 channels.
processGeohash-0
processGeohash-01 
processGeohash-012
.....
These channels are not accessible by a normal seapal user, so that the documents will not be send to other users.
A Bot Server is now able to subscribe to any of these channels. If he subscribe to a channel, he will be notified
from the Sync Gateway, if a new document will be added with the position of a user. The Bot Server then need
to create a document with all active users after a defined timeout. The document which will be created by the Bot
Server is accessible by every Seapal User, so that they get notified about other active users.
A Bot Server, which handle all geohash locations, simply subscribe to 32 Geohashs from processGeohash-0 to processGeohash-z.

####Can a Client control the locations from which he like to get summary documents?
>Yes, a Bot Server create a document with all users from a specified location. These documents are from the type "publishGeohash", and 
are mapped to the geohash locations which are observed by this Bot Server. A Client can subscribe to these locations by creating
a "subscribeGeohash" document. This document contain the geohash locations from which the client like to get updates. To get all
updates a client simply subscribe from geohash-0 to geohash-z.

#Configuration
The complete configuration is stored in the **config.json** file.

The **server** Attribute contain all information about the running server.
* loginUrl        : The URL, to which the bots can sent the login data. This is the URL of the play server.
* logoutUrl       : The same as the loginUrl, except that the bot gets logged out.
* syncGatewayUrl  : The URL to the sync Gateway.

The **couchbase** Attribute contain specific information about the couchbase server which will be asked for the view. This information
will only be used, if we start an observer which uses the view mechanism.
* bucket              : The bucket, which contain our data we like to query
* host                : The couchbase server adress
* operationTimeout    : The time, after which a timeout occurr when the view will be queried without an answer
* connectionTimeout   : The time, after which a timeout occurr when there could no connection to the server established.
        
The **user** Attribute contain the information about the sync Gateway user for this bot. Checkout "trackObserverBot1" in the Sync Gateway
Configuration.
* email               : Sync Gateway email
* password            : Password for login on sync Gateway

If we do not use a view to summarize the data, the **noView** Attribute will be used.
* channels            : The geohash channels to which the bot server listen, to summarize from these channels.
* timeout             : The frequency for creating a summary document in seconds.
* validTime           : The time in seconds, how long a position document of a user is valid.

If we use a view, we need the **view** Attribute.

**Make sure that the [view](https://github.com/deparlak/de.htwg.seapal.worker.trip.observer/blob/master/view.txt) was created on in couchbase server.**
* design              : The design document, under which our view is stored on the couchbase server
* name                : The name of the view on the couchbase server.
* opts                : Some view specific parameters, to set max documents, set reduce to false and stale.
* channelStart        : Set the start range of the query range. Startkey will be set to actualTime + channelStart (=geohash to start)
* channelEnd          : Set the start range of the query range. Startkey will be set to actualTime + 1 + channelEnd (=geohash to end) 
* channels            : The channels we like to map the document which will be created by the bot server. This should be the same channel
                      range as with channelStart and channelEnd.
* queryTimeout        : The timeout after which to call the query again in seconds.
        
``` 
{
    "server" : {     
        "loginUrl"      :   "http://localhost:9000/login",
        "logoutUrl"     :   "http://localhost:9000/logout",
        "syncGatewayUrl":   "http://localhost:9000/database"
    },
    
    "couchbase" : {
        "bucket"            :   "sync_gateway",
        "host"              :   ["http://localhost:8091/"],
        "operationTimeout"  :   2500,
        "connectionTimeout" :   5000
    },
    
    "user" : {
        "email"             :   "trackObserverBot1",
        "password"          :   "TBD_A_PASSWORD"
    },
    
    "noView" : {
        "channels"          :   ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "b", "c", "d", "e", "f", "g", "h", "j", "k", "m", "n", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"],
        "timeout"           :   5,
        "validTime"         :   60
    },
    
    "view" : {
        "design"        :   "geohash",
        "name"          :   "activeTrips",
        "opts"          : {
            "limit"           :   10000,
            "reduce"          :   false,
            "stale"           :   "false"
        },
        "settings"      : {
            "channelStart"  :  ["0"],
            "channelEnd"    :  ["Z"],
            "channels"      :  ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "b", "c", "d", "e", "f", "g", "h", "j", "k", "m", "n", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"],
            "queryTimeout"  :   5
        }
    }
}
```

#Execute
To run the application you should start a command line.
``` 
# install all packages.
npm install
# If you are using the no View mechanism, you have to subscribe to the channels you like to observe.
# This will be done by calling the init script.
node noViewInit
# This command will start an observer which uses no view
node noView
# This command will start an observer using a view (note that you need couchbase for this).
node view
```