FROM node:latest

RUN mkdir -p /opt/pulldasher
WORKDIR /opt/pulldasher

# Install dependencies
COPY package.json /opt/pulldasher
RUN npm install

COPY . /opt/pulldasher

RUN npm install -g bower grunt-cli
RUN bower install --allow-root

# This makes the bootstrapcdn link the font path, instead of loading it locally.
RUN sed -i -e "/^@fa-font-path/d" bower_components/font-awesome/less/variables.less
RUN sed -i -e "s/\/\/@fa-font-path/@fa-font-path/" bower_components/font-awesome/less/variables.less

RUN grunt

EXPOSE 8080
CMD ["bin/pulldasher"]
