.PHONY: setup run clean

setup:
	npm install
	bower install
	grunt

run: setup
	./bin/pulldasher

clean:
	rm -r ./bower_components
	rm -r ./node_modules
	rm -r ./views/standard/css/
