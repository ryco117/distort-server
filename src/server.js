var express = require('express'),
  config = require('./config'),
  mongoose = require('mongoose'),
  Account = require('./api/models/accountModel'),
  Cert = require('./api/models/certModel'),
  Group = require('./api/models/groupModel'),
  InMessage = require('./api/models/inMessageModel'),
  OutMessage = require('./api/models/outMessageModel'),
  Peer = require('./api/models/peerModel'),
  bodyParser = require('body-parser'),
  distort_ipfs = require('./distort-ipfs');

var app = express();

// Some constants
const DEBUG = config.debug;
const PORT = config.port;

// Connect to MongoDB
mongoose.Promise = global.Promise;
mongoose.connect('mongodb://localhost/distort', {useNewUrlParser: true});

distort_ipfs.initIpfs(config.ipfsNode.address, config.ipfsNode.port);

// Setup middleware
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Allow for unauthenticated query-ing of server info
var nodeRouting = require('./api/routes/nodeRoutes');
nodeRouting(app);

// Before allowing standard Routes, confirm authenticated
var authenticated = require('./api/routes/authenticatedRoutes');
authenticated(app);

// Add proper routing to REST loop
var routes = require('./api/routes/distortRoutes');
routes(app);

// Start main REST loop
app.listen(PORT);
console.log('RESTful API server started on port: ' + PORT);
