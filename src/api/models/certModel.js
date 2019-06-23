"use strict";
var mongoose = require('mongoose'),
  Schema = mongoose.Schema;

var CertSchema = new Schema({
  accountName: {
    type: String,
    default: 'root'
  },
  groups: [
    String
  ],
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
  },
  socialMedia: [
    {
      handle: {
        type: String,
        required: 'Platform must be associated with a user handle (ID)'
      },
      key: {
        type: String
      },
      platform: {
        type: String,
        required: 'Must specify the social-media platform to link identities with'
      }
    }
  ],
  status: {
    type: String,
    enum: ['valid', 'invalidated'],
    default: 'valid'
  },
});

// Peer cannot have multiple certs of the same public/private key values.
// Must either update old key times or add a new key and invalidate the old
CertSchema.index({accountName: 1, peerId: 1, key: 1}, {unique: true});

module.exports = mongoose.model('Certs', CertSchema);
