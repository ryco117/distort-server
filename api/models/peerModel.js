"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var PeerSchema = new Schema({
  cert: {
    type: mongoose.Schema.Type.ObjectId,
    ref: 'Certs',
    required: 'Must include certificate with peer definition'
  },
  nickname: {
    type: String
  },
  peerId: {
    type: String,
    required: 'Must be associated with an IPFS peer-ID'
  }
});

module.exports = mongoose.model('Peers', PeerSchema);