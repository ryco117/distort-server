"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var PeerSchema = new Schema({
  accountName: {
    type: String,
    default: 'root'
  },
  cert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Certs'
  },
  nickname: {
    type: String
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Accounts',
    required: 'Peer must be associated with a local owning account'
  },
  peerId: {
    type: String,
    required: 'Must be associated with an IPFS peer-ID'
  }
});

// An owning account can not have multiple peers with the same nickname
PeerSchema.index({owner: 1, nickname: 1}, {unique: true});

// An account can not have multiple nicknames for one peer
PeerSchema.index({owner: 1, accountName: 1, peerId: 1}, {unique: true});

module.exports = mongoose.model('Peers', PeerSchema);
