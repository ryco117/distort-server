"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var GroupSchema = new Schema({
  accountId: {
    type: String,
    required: 'Must be associated with the IPFS peer-ID of the creating account'
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
  subgroupIndex: {
    type: Number,
    required: 'Must be a Non-negative Integer'
  }
});

module.exports = mongoose.model('Groups', GroupSchema);