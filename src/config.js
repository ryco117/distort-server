var fs = require('fs');

// Load configuration
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

// Export known parameters
exports.debug = config.debug;
exports.port = config.port;
exports.ipfsNode = config.ipfsNode;
exports.protocolVersion = config.protocolVersion;
exports.mongoAddress = config.mongoAddress;
