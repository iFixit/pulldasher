const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const definePluginReadFile = require('./webpack-define-read-file');

const relative = (pathPart) => path.resolve(__dirname, pathPart);
const dummyPullsPath = process.env.DUMMY_PULLS && path.resolve(process.env.DUMMY_PULLS);
const dummyUser = process.env.DUMMY_USER;

module.exports = {
   node: false,
   module: {
      rules: [
         {
            // for any file with a suffix of js,jsx,ts,tsx
            test: /\.(jsx?|tsx?)$/,
            // ignore transpiling JavaScript from node_modules as it should be that state
            exclude: /node_modules/,
            // use the babel-loader for transpiling JavaScript to a suitable format
            use: [
               {
                  loader: 'babel-loader',
                  options: {
                     // attach the presets to the loader (most projects use .babelrc file instead)
                     presets: [
                        "@babel/preset-env",
                        ["@babel/preset-react", { runtime: "automatic" }]
                     ]
                  }
               },
               { loader: 'ts-loader' },
               { loader: 'eslint-loader' },
            ],
         }, {
            test: /\.less$/,
            use: [{
               loader: 'style-loader' // creates style nodes from JS strings
            }, {
               loader: 'css-loader'
            }, {
               loader: 'less-loader'
            }]
         },
      ]
   },
   resolve: {
      extensions: ['.ts', '.tsx', '.js', '.less'],
   },
   output: {
      path: relative("dist"),
      publicPath: '/frontend'
   },
   entry: {
      "main": relative("src/index.tsx"),
      "pull-card-demo": relative("test/pull-card-demo.tsx"),
   },
   plugins: [
      new webpack.DefinePlugin({
         "process.env.DUMMY_PULLS": dummyPullsPath ? definePluginReadFile(dummyPullsPath) : null,
         "process.env.DUMMY_USER": JSON.stringify(dummyUser),
      }),
      new HtmlWebpackPlugin({
         template: relative("index.html"),
         chunks: ["main"],
      }),
      new HtmlWebpackPlugin({
         template: relative("index.html"),
         filename: "./pull-card-demo.html",
         chunks: ["pull-card-demo"],
      })
   ],
   mode: 'development',
   devtool: 'eval-cheap-module-source-map',
   devServer: {
      open: ["frontend/"],
   }
};
