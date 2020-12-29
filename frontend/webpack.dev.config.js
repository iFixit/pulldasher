const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const definePluginReadFile = require('./webpack-define-read-file');

const relative = (pathPart) => path.resolve(__dirname, pathPart);
const dummyPullsPath = process.env.DUMMY_PULLS;

module.exports = {
   module: {
      rules: [
         {
            // for any file with a suffix of js or jsx
            test: /\.jsx?$/,
            // ignore transpiling JavaScript from node_modules as it should be that state
            exclude: /node_modules/,
            // use the babel-loader for transpiling JavaScript to a suitable format
            loader: 'babel-loader',
            options: {
               // attach the presets to the loader (most projects use .babelrc file instead)
               presets: ["@babel/preset-env", "@babel/preset-react"]
            }
         }, {
            test: /\.tsx?$/,
            loader: 'ts-loader'
         }
      ]
   },
   resolve: {
      extensions: ['.ts', '.tsx', '.js'],
   },
   output: {
      path: relative("dist"),
      publicPath: '/frontend'
   },
   entry: {
      "main": relative("src/index.tsx")
   },
   plugins: [
      new webpack.DefinePlugin({
         "process.env.DUMMY_PULLS": dummyPullsPath ? definePluginReadFile(dummyPullsPath) : null
      }),
      new HtmlWebpackPlugin()
   ],
   mode: 'development',
   devtool: 'eval-cheap-module-source-map',
   devServer: {
      open: true,
      openPage: "frontend/"
   }
};
