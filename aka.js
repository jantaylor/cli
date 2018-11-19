#!/usr/bin/env node

"use strict"

const assert = require('assert')
const proc = require('child_process');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

function zzh_template(yargs) {
  let cmd = path.basename(yargs.$0)
  let cmd_path = yargs.$0;
  if (cmd_path.match(/\.js$/)) {
    cmd_path = `./${cmd_path}`
  }
  return `
###-begin-${cmd}-completions-###
_aka_yargs_completions()
{
  local reply
  local si=$IFS
  IFS=$'\n' reply=($(COMP_CWORD="$((CURRENT-1))" COMP_LINE="$BUFFER" COMP_POINT="$CURSOR" ${cmd_path} --get-yargs-completions "$\{words[@]\}"))
  IFS=$si
  _describe 'values' reply
}
compdef _aka_yargs_completions ${cmd}
###-end-${cmd}-completions-###
`
}

function bash_template(yargs) {
  let cmd = path.basename(yargs.$0)
  let cmd_path = yargs.$0;
  if (cmd_path.match(/\.js$/)) {
    cmd_path = `./${cmd_path}`
  }
  return `
###-begin-${cmd}-completions-###
_aka_yargs_completions()
{
    local cur_word args type_list

    cur_word="$\{COMP_WORDS[COMP_CWORD]\}"
    args=("$\{COMP_WORDS[@]\}")

    # ask yargs to generate completions.
    type_list=$(${cmd_path} --get-yargs-completions "$\{args[@]\}")

    COMPREPLY=( $(compgen -W "$\{type_list\}" -- $\{cur_word\}) )

    # if no match was found, fall back to filename completion
    if [ $\{#COMPREPLY[@]\} -eq 0 ]; then
      COMPREPLY=( $(compgen -f -- "$\{cur_word\}" ) )
    fi

    return 0
}
complete -F _aka_yargs_completions ${cmd}
###-end-${cmd}-completions-###
`
}

process.on('uncaughtException', (e) => {
  if(process.env.DEBUG) {
    console.error(e.message)
    console.error(e.stack)
  } else {
    console.log("An unexpected error occured, if this persists try running `mv ~/.akkeris ~/.akkeris.backup`.\n.  -> Pro tip: Add DEBUG=true to your environment for more information.")
  }
})

function init_plugins(m, plugins_dir) {
  fs.readdirSync(plugins_dir).sort((a, b) => { return a < b ? -1 : 1 }).forEach((plugin => {
    if(path.basename(plugin).startsWith('.') || path.basename(plugin).startsWith("tmp")) {
      return;
    }
    try {
      if(fs.statSync(path.join(plugins_dir, plugin, 'index.js')).isFile()) {
        try {
          m.exports.plugins[plugin] = require(path.join(plugins_dir, plugin, 'index.js'));
        } catch (err) {
          console.log(m.exports.terminal.markdown(`\n !!▸!! error loading plugin "${plugin}": ${err}\n`));
        }
        if(m.exports.plugins[plugin] && m.exports.plugins[plugin].init) {
          try {
            m.exports.plugins[plugin].init(m.exports);
          } catch (err) {
            console.log(m.exports.terminal.markdown(`\n !!▸!! error initializing plugin "${plugin}": ${err}\n`));
          }
        }
      }
    } catch (err) {
      console.log(m.exports.terminal.markdown(`\n !!▸!! error initializing plugin "${plugin}": ${err}\n`));
    }
  }));
}

function get_home() {
  return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}

function create_dir(directory) {
  let stats = null;
  try {
    stats = fs.statSync(directory);
  } catch (e) {
    try {
      fs.mkdirSync(directory);
      stats = fs.statSync(directory);
    } catch (e) {
      console.error(`The plugins directory cannot be accessed, could not be created, or is a file (${directory}).`);
      return null;
    }
  }
}

function squirrel() {
  console.log(`
                              _
                          .-'\` \`}
                  _./)   /       }
                .'o   \\ |       }
                '.___.'\`.\\    {\`
                /\`\\_/  , \`.    }
                \\=' .-'   _\`\  {
                 \`'\`;/      \`,  }
                    _\\       ;  }
                   /__\`;-...'--'

                   SQUIRREL!

  `)
}

function set_profile(appkit, args, cb) {
  if(!args || !args.auth || !args.app) {
    appkit.terminal.question('Akkeris Auth Host (auth.example.com): ', (auth) => {
      appkit.terminal.question('Akkeris Apps Host (apps.example.com): ', (apps) => {
        if (auth.startsWith('https://') || auth.startsWith('http://')) {
          auth = (new url.URL(auth)).hostname
        }
        if (apps.startsWith('https://') || apps.startsWith('http://')) {
          apps = (new url.URL(apps)).hostname
        }
        fs.writeFileSync(path.join(get_home(), '.akkeris', 'config.json'), JSON.stringify({auth, apps}, null, 2));
        process.env.AKKERIS_API_HOST = apps
        process.env.AKKERIS_AUTH_HOST = auth
        console.log("Profile updated!")
      });
    });
  }
}

function load_profile() {
  if(!process.env.AKKERIS_API_HOST || !process.env.AKKERIS_AUTH_HOST) {
    try {
      let config = JSON.parse(fs.readFileSync(path.join(get_home(), '.akkeris', 'config.json')).toString('UTF8'))
      process.env.AKKERIS_AUTH_HOST = config.auth;
      process.env.AKKERIS_API_HOST = config.apps;
    } catch (e) {
      if(process.argv && (process.argv[1] === 'auth:profile' || process.argv[2] === 'auth:profile' || process.argv[3] === 'auth:profile')) {
        return;
      }
      welcome()
    }
  }
}

function welcome() {
  console.log("")
  console.log("Hi! It looks like you might be new here. Lets take a second")
  console.log("to get started, you'll need your akkeris auth and apps host")
  console.log("in addition to your login and password.")
  console.log("")
  proc.spawnSync('ak',['auth:profile'], {env:process.env, stdio:'inherit'});
  proc.spawnSync('ak',['auth:login'], {env:process.env, stdio:'inherit'});
}
 
let zsh_shell = process.env.SHELL && process.env.SHELL.indexOf('zsh') !== -1;

// xyz[0] == command name + any arguments
// xyz[1] == command description, if false no description
// xyz[2] == optional params.
// xyz[3] == function to call
// xyz[4] == aliases
// xyz[5] == overloaded async function(option)
let available_commands = [];

function install_auto_completions(appkit) {
  let task = appkit.terminal.task('Installing autocomplete scripts, this will take affect with the next shell.')
  task.start()
  if(zsh_shell) {
    // See: https://github.com/yargs/yargs/issues/1156
    fs.writeFileSync(path.join(get_home(), '.zshrc'), zzh_template(module.exports.args), {'flag':'a'})
  } else {
    fs.writeFileSync(path.join(get_home(), '.bash_profile'), bash_template(module.exports.args), {'flag':'a'})
  }
  task.end('ok')
}

async function find_auto_completions(current, argv, cb) {
  try {
    if(argv._[1] || current === '--') {
      let matched = available_commands.filter((c) => c[1] && c[0].replace(/\\/g, '').split(' ')[0].toLowerCase() === argv._[1])
      if(matched.length > 0) {
        // See if there's a command name, or if its just options left.
        let m = matched[0][0].split(' ')
        let ndx = (m.length - 1) - (argv._.filter((x) => x !== '').length - 2)
        if(ndx === 0) {
          let returns = Object.keys(matched[0][2]).map((option) => {
            if(zsh_shell) {
              return '--' + option.replace(/:/g, '\\:') + ':' + matched[0][2][option].description
            } else {
              return '--' + option
            }
          })
          return cb(returns)
        } else {
          // find the next arg
          if(matched[0][5]) {
            try {
              return cb(await matched[0][5](m[ndx]))
            } catch (e) {
              return cb([])
            }
          } else {
            return cb([m[ndx]])
          }
        }
      }
    }

    let matches = available_commands.filter((c) => c[1] && c[0].toLowerCase().startsWith(current.toLowerCase()));
    if(matches.length === 0) {
      // hail marry
      matches = available_commands.filter((c) => c[1] && c[0].toLowerCase().indexOf(current.toLowerCase()) > -1);
    }
    if(zsh_shell) {
      cb(matches.map((c) => c[0].replace(/:/g, '\\:').split(' ')[0] + ":" + c[1]))
    } else {
      cb(matches.map((c) => c[0].split(' ')[0]))
    }
  } catch (e) {
    return cb([])
  }
}

// Initialize, setup any items at runtime
module.exports.init = function init() {

  // Set common dir paths
  let akkeris_home = path.join(get_home(), '.akkeris')
  let akkeris_plugins = path.join(get_home(), '.akkeris', 'plugins')
  let akkeris_base_plugins = path.join(path.dirname(module.filename), 'plugins')

  // Create necessary directories
  create_dir(akkeris_home)
  create_dir(akkeris_plugins)
  create_dir(akkeris_base_plugins)

  module.exports.terminal = require(path.join(__dirname, 'lib', 'terminal.js'))

  load_profile()

  module.exports.config = {
    plugins_dir:null, 
    akkeris_api_host:(process.env.AKKERIS_API_HOST),
    akkeris_auth_host:(process.env.AKKERIS_AUTH_HOST),
    package:JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json').toString('utf8')))
  };
  
  // Establish the base arguments for the CLI.
  module.exports.args = require('yargs');
  let pcommand = module.exports.args.command;
  module.exports.args.command = function(...xyz) {
    available_commands.push(xyz)
    pcommand.call(module.exports.args, xyz[0],xyz[1],xyz[2],xyz[3],xyz[4])
    return module.exports.args
  }

  module.exports.args
    .usage('Usage: akkeris COMMAND [--app APP] [command-specific-options]')
    .command('update', 'update the akkeris client', {}, module.exports.update.bind(null, module.exports))
    .command('version', 'display version', {}, module.exports.version.bind(null, module.exports))
    .command('squirrel', false, {}, squirrel)
    .command('auth:profile', 'Set the authorization endpoint and apps end point', {
        "apps":{ "description":"The URL for the apps API end point." },
        "auth":{ "description":"The URL for the auth API end point." }
      }, set_profile.bind(null, module.exports))
    .command('autocomplete', `adds the shell autocompletion.`, {}, install_auto_completions.bind(null, module.exports))
    .completion('__notused', false, find_auto_completions)
    .recommendCommands()
  // map cli width for yargs
  module.exports.args.wrap(module.exports.args.terminalWidth())
  module.exports.random_tips = [
    '🚀  Fun tip! You can use "latest" rather than a specific ID for builds and releases when getting info.',
  ];

  // load plugins
  module.exports.plugins = {};
  module.exports.config.plugins_dir = path.join(path.dirname(module.filename), 'plugins')
  module.exports.config.third_party_plugins_dir = path.join(get_home(), '.akkeris', 'plugins')
  require('./lib/plugins.js').init(module.exports.args, module.exports);

  assert.ok(module.filename, 'No module.filename exists, no clue where we are. This is a very odd error.');
  
  // Scan and initialize the plugins as needed.
  init_plugins(module, module.exports.config.plugins_dir)
  init_plugins(module, module.exports.config.third_party_plugins_dir)
  
  // Grab netrc info
  const netrc = require('netrc')();
  module.exports.account = netrc[module.exports.config.akkeris_api_host];
}

module.exports.version = function version(appkit, args) {
  console.log("akkeris/" + appkit.config.package.version + " " + process.arch + "-" + process.platform + " node-" +process.version);
  console.log(appkit.terminal.markdown(`###===### Installed Plugins`));
  Object.keys(module.exports.plugins).forEach((plugin) => {
    console.log(module.exports.plugins[plugin].group + " " + (module.exports.plugins[plugin].version ? "@" + module.exports.plugins[plugin].group : ""))
  });
}

// Update our dependencies and our plugins as needed.
module.exports.update = function update(appkit) {
  assert.ok(appkit.config.third_party_plugins_dir, 'Update was ran without init being ran first, everything is empty.');
  fs.readdirSync(appkit.config.third_party_plugins_dir).forEach((plugin => {
    try {
      if(fs.statSync(path.join(appkit.config.third_party_plugins_dir, plugin, '.git')).isDirectory()) {
        console.log(appkit.terminal.markdown(`###===### updating ${plugin} plugin`));
        proc.spawnSync('git',['pull', '--quiet'], {cwd:path.join(appkit.config.third_party_plugins_dir, plugin), env:process.env, stdio:'inherit'});
        if(fs.statSync(path.join(appkit.config.third_party_plugins_dir, plugin, 'index.js')).isFile()) {
          if(module.exports.plugins[plugin].update) {
            try {
              require(path.join(appkit.config.third_party_plugins_dir, plugin, 'index.js')).update(module.exports);
            } catch (err) {
              console.log(appkit.terminal.markdown(` !!▸!! error updating plugin "${plugin}": ${err}`));
            }
          }
        }
      }
    } catch (e) {
      // skip.
      if(process.env.NODE_DEBUG) {
        console.info(e);
      }
    }
  }));
  console.log(appkit.terminal.markdown(`###===### updating akkeris`));
  proc.spawnSync('npm',['update', '-g', 'akkeris'], {cwd:__dirname, env:process.env, stdio:'inherit'});
}

function is_redirect(type, res) { return type.toLowerCase() === 'get' && res.headers['location'] && (res.statusCode === 301 || res.statusCode === 302); }
function is_response_ok(res) { return res.statusCode > 199 && res.statusCode < 300 ? true : false; }
function response_body(type, callback, res) {
  let body = Buffer.alloc(0);
  res.on('data', (e) => body = Buffer.concat([body,e]) );
  res.on('end', (e) => {
    if(res.headers['content-encoding'] === 'gzip' && body.length > 0) {
      body = zlib.gunzipSync(body);
    }
    if(is_redirect(type, res)) {
      get(res.headers['location'], headers, callback);
    } else if(is_response_ok(res)) {
      callback(null, res.headers['content-type'] === 'application/zip' ? body : body.toString('utf8'), res.headers);
    } else {
      callback({code:res.statusCode, body, headers:res.headers}, null);
    } 
  });
}

function req_help(type, payload, rurl, headers, callback, resolve, reject) {
    let connector = rurl.startsWith('http://') ? http : https;
    let opts = url.parse(rurl);
    opts.method = type;
    opts.headers = headers || {};
    let req = connector.request(opts, response_body.bind(null, type, (e, d) => { 
      if(d) {
        d = JSON.parse(d)
      }
      if(callback) callback(e,d);
      if(e) {
        reject(e)
      } else {
        resolve(d)
      }
    }));
    if(payload) {
      req.write(payload);
    }
    req.on('abort', (err) => {
      if(callback) callback(new Error("Request aborted."))
        reject(new Error("Request aborted."))
    })
    req.on('error', (err) => {
      if(callback) callback(err); 
      reject(err)
    });
    req.end();
}

function request(type, payload, rurl, headers, callback) {
  if(callback) {
    req_help(type, payload, rurl, headers, callback, () => {}, () => {})
  } else {
    return new Promise((resolve, reject) => {
      req_help(type, payload, rurl, headers, null, resolve, reject)
    })
  }
}

function appkit_request(type, payload, rurl, callback) {
  let headers = {};
  headers['content-type'] = headers['content-type'] || 'application/json';
  if(module.exports.account && module.exports.account.password) {
    headers['authorization'] = 'Bearer ' + module.exports.account.password;
  }
  // Override for bearer token
  if(process.env.API_TOKEN) {
    headers['authorization'] = 'Bearer ' + process.env.API_TOKEN;
  }
  // Override if shared-secret is used
  if(process.env.API_AUTH) {
    headers['authorization'] = process.env.API_AUTH;
  }
  headers['accept'] = '*/*';
  headers['accept-encoding'] = 'gzip';
  headers['user-agent'] = 'akkeris-cli';

  let full_url = rurl.startsWith("http") ? rurl : 
                ( (module.exports.config.akkeris_api_host.startsWith("http") ? 
                    module.exports.config.akkeris_api_host : 
                    'https://' + module.exports.config.akkeris_api_host) + rurl);
  return request(type, payload, full_url, headers, callback);
}

module.exports.http = {
  get:request.bind(null, 'get', null),
  post:request.bind(null, 'post'),
  patch:request.bind(null, 'patch'),
  delete:request.bind(null, 'delete', null),
  put:request.bind(null, 'put')
}

module.exports.api = {
  get:appkit_request.bind(null, 'get', null),
  post:appkit_request.bind(null, 'post'),
  patch:appkit_request.bind(null, 'patch'),
  delete:appkit_request.bind(null, 'delete', null),
  put:appkit_request.bind(null, 'put')
}

if(require.main === module) {
  module.exports.init();
  module.exports.args
    .strict()
    .demand(1)
    .epilog(module.exports.random_tips[Math.floor(module.exports.random_tips.length * Math.random())])
    .argv
}
