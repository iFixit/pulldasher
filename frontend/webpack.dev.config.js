import webpack from 'webpack';
import path from 'path';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import definePluginReadFile from './webpack-define-read-file.js';
import ESLintPlugin from 'eslint-webpack-plugin';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const relative = pathPart => path.resolve(__dirname, pathPart);
const dummyPullsPath = process.env.DUMMY_PULLS && path.resolve(process.env.DUMMY_PULLS);
const dummyUser = process.env.DUMMY_USER;

export default {
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
                        '@babel/preset-env',
                        ['@babel/preset-react', { runtime: 'automatic' }],
                     ],
                  },
               },
               { loader: 'ts-loader' },
            ],
         },
         {
            test: /\.less$/,
            use: [
               {
                  loader: 'style-loader', // creates style nodes from JS strings
               },
               {
                  loader: 'css-loader',
               },
               {
                  loader: 'less-loader',
               },
            ],
         },
      ],
   },
   resolve: {
      extensions: ['.ts', '.tsx', '.js', '.less'],
   },
   output: {
      path: relative('dist'),
      // v1 is served side-by-side under /v1 (v2 owns the root), so its built
      // asset URLs must resolve there. The app code is otherwise unchanged.
      publicPath: '/v1/',
   },
   entry: {
      main: relative('src/index.tsx'),
      'pull-card-demo': relative('test/pull-card-demo.tsx'),
   },
   plugins: [
      new webpack.DefinePlugin({
         'process.env.DUMMY_PULLS': dummyPullsPath ? definePluginReadFile(dummyPullsPath) : null,
         'process.env.DUMMY_USER': JSON.stringify(dummyUser),
      }),
      new HtmlWebpackPlugin({
         template: relative('index.html'),
         chunks: ['main'],
      }),
      new HtmlWebpackPlugin({
         template: relative('index.html'),
         filename: './pull-card-demo/index.html',
         chunks: ['pull-card-demo'],
      }),
      new ESLintPlugin({
         extensions: ['ts', 'tsx', 'js'],
      }),
   ],
   mode: 'development',
   devtool: 'eval-cheap-module-source-map',
   devServer: {
      open: ['/'],
      static: {
         directory: 'public',
         publicPath: '/public',
      },
      // Mirror production's single-app shape in dev: the real server mounts the
      // v2 build at /v2, so forward /v2 to frontend-v2's Vite dev server (vite
      // already serves at base /v2/; ws carries its HMR socket). If Vite isn't
      // running, /v2 just 502s -- v1 is unaffected.
      proxy: [
         {
            context: ['/v2'],
            target: 'http://localhost:5173',
            ws: true,
         },
      ],
   },
};
