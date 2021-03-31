const dev = require('./webpack.dev.config.js');
dev.mode = 'production';
dev.devtool = 'source-map';
module.exports = dev;
