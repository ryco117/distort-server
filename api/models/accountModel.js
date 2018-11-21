"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var AccountSchema = new Schema({
  activeGroupId: {
    type: mongoose.Schema.Type.ObjectId,
    ref: 'Groups'
  },
  cert: {
    type: mongoose.Schema.Type.ObjectId,
    ref: 'Certs',
    required: 'Account must be given a certificate ID to use for its key-pair'
  },
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  peerId: {
    type: String,
    required: 'Must be associated with an IPFS peer-ID',
    unique: true
  },
  tokenHash: {
    type: String,
    required: 'Token-hash is required to authenticate user'
  }
});

module.exports = mongoose.model('Accounts', AccountSchema);