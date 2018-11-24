"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var GroupSchema = new Schema({
  accountName: {
    type: String,
    default: 'root'
  },
  height: {
    type: Number,
    default: 0
  },
  lastReadIndex: {
    type: Number,
    default: -1
  },
  name: {
    type: String,
    required: 'Must give this group a name'
  },
  peerId: {
    type: String,
    required: 'Must be associated with the peer-ID of the creating account'
  },
  subgroupIndex: {
    type: Number,
    required: 'Must be a Non-negative Integer'
  }
});

// Each pair of account (a pair IPFS-ID and account-name) and group must be unique. Thus a single account can only subscribe to a given group once
GroupSchema.index({peerId: 1, accountName:1, name: 1}, {unique: true});

module.exports = mongoose.model('Groups', GroupSchema);
