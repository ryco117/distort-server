"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var AccountSchema = new Schema({
  accountName: {
    type: String,
    default: 'root'
  },
  activeGroup: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Groups'
  },
  cert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Certs',
    required: 'Account must be given a certificate ID to use for its key-pair'
  },
  enabled: {
    type: Boolean,
    default: true
  },
  peerId: {
    type: String,
    required: 'Must be associated with an IPFS peer-ID'
  },
  tokenHash: {
    type: String,
    required: 'Token-hash is required to authenticate user'
  }
});

// Each pair peerId:accountName must be unique. Thus a single IPFS node may host multiple accounts
AccountSchema.index({accountName: 1, peerId: 1}, {unique: true});

module.exports = mongoose.model('Accounts', AccountSchema);
