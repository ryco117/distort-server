var express = require('express'),
  mongoose = require('mongoose'),
  Account = require('./api/models/accountModel'),
  Group = require('./api/models/groupModel'),
  InMessage = require('./api/models/inMessageModel'),
  OutMessage = require('./api/models/outMessageModel'),
  bodyParser = require('body-parser'),
  distort_ipfs = require('./distort-ipfs');

var app = express();

// Some constants
const DEBUG = true;
const port = process.env.PORT || 6945;

// Connect to MongoDB
mongoose.Promise = global.Promise;
mongoose.connect('mongodb://localhost/distort', { useNewUrlParser: true });

distort_ipfs.initIpfs('192.168.0.104', '5001');

// Setup middleware
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

// Before allowing standard Routes, confirm authenticated
var authenticated = require('./api/routes/authenticatedRoutes');
authenticated(app);

// Add proper routing to REST loop
var routes = require('./api/routes/distortRoutes');
routes(app);

// Start main REST loop
app.listen(port);
console.log('RESTful API server started on port: ' + port);