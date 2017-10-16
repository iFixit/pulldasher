FROM node:latest

RUN mkdir -p /opt/pulldasher
WORKDIR /opt/pulldasher

# Install dependencies
COPY . /opt/pulldasher
RUN npm install --unsafe-perm


EXPOSE 8080
CMD ["bin/pulldasher"]
