.PHONY: setup run clean

setup:
	npm install

run: setup
	./bin/pulldasher

clean:
	rm -r ./bower_components
	rm -r ./node_modules
	rm -r ./views/standard/css/
