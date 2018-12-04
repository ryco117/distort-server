"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var ConversationSchema = new Schema({
  accountName: {
    type: String,
    default: 'root'
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Groups',
    required: 'Must reference the existing group conversation is over'
  },
  height: {
    type: Number,
    default: 0
  },
  latestStatusChangeDate: {
    type: Date,
    default: Date.now
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Accounts',
    required: 'Must specify local account participating in this converation'
  },
  peerId: {
    type: String,
    required: 'Must be associated with an IPFS peer\'s ID'
  },
});

// Account cannot have multiple converasations with the same peer, in the same group.
ConversationSchema.index({owner: 1, group: 1, peerId: 1, accountName: 1}, {unique: true});

module.exports = mongoose.model('Conversations', ConversationSchema);
