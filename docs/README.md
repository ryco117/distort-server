# DistoRt Homeserver
([main page](https://ryco117.github.io/distort-server))

## REST API
### Unauthenticated
* /ipfs
    * GET
        - Return type: string
        - Return value: the actively connected IPFS node's ID
        
### Authenticated
* /groups
	* GET
	    - Return type: array of group objects
	    - Return value: the groups that the authenticated account belongs to
	* POST
* /groups/:group-name
	* GET
	    - Return type: array of conversation objects
	    - Return value: the conversations under group `group-name` that have been started (meaning at least one message has been sent or received)
	* PUT
	* DELETE
* /groups/:group-name/:index-start/[:index-end]
	* GET
	    - Return type: an object containing two fields, `in` and `out`, each of which are arrays of message objects
	    - Return value: all received and sent (respectively) messages in 
* /account
	* GET
	* PUT
* /peers
	* GET
	* POST
	* DELETE
	
---
Note: Authenticated HTTP requests take headers: 
* `peerid` set to the IPFS node ID of the account to authorize as. Must be equal to the IPFS ID of the current node in use.
* `authtoken` set to the Base64 encoded hash of the account's password. Hash algorithm is PBKDF2 using SHA-256. The salt is the IPFS node ID (equivalent to `peerid`), and the work-constant is `1000`.
* (Optional) `accountname` set to the name of the account to authorize as. If field is not specified or empty, will default to `root`.

