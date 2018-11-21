all: node_modules/sjcl.js

node_modules/sjcl.js:
	git submodule init
	[ -f sjcl/configure ] || git submodule update
	cd sjcl && ./configure --compress=closure --with-all && make
	cp sjcl.js ../node_modules/

clean:
	rm -f sjcl/sjcl.js
