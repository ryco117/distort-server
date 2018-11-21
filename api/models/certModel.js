"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var CertSchema = new Schema({
  groups: [{
    name: String,
    subgroupIndex: Number
  }],
  key: {
    encrypt: {
      pub: {
        type: String
      },
      sec: {
        type: String
      }
    },
    sign: {
      pub: {
        type: String
      },
      sec: {
        type: String
      }
    }
  },
  lastExpiration: {
    type: Date,
    required: 'Must be given an expiration, which can be extended later'
  },
  peerId: {
    type: String,
    required: 'Must be associated with an IPFS peer-ID'
  }
});

module.exports = mongoose.model('Certs', CertSchema);