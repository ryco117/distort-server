var express = require('express'),
  config = require('./config'),
  mongoose = require('mongoose'),
  Account = require('./api/models/accountModel'),
  Conversation = require('./api/models/conversationModel'),
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
const connectDatabase = () => {
  mongoose.connect(config.mongoAddress, {useNewUrlParser: true}).then(() => {
    console.log('Connected to Mongo database');
    const connectIPFS = () => {
      distort_ipfs.initIpfs(config.ipfsNode.address, config.ipfsNode.port).then(() => {
        console.log('Initialized server instance');

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
      }).catch(err => {
        console.error('Failed to initialize: ' + err);
        console.log('Retry in 5 seconds...');
        setTimeout(connectIPFS, 5000);
      });
    }
    connectIPFS();
  }).catch(err => {
    console.error('Failed to connect to mongodb: ' + err);
    console.log('Retry in 5 seconds...');
    setTimeout(connectDatabase, 5000);
  });
};
connectDatabase();
