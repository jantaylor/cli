"use strict"

function app_or_error(appkit, name, cb) {
  appkit.api.get('/apps/' + name, (err, app) => {
    if(err) {
      appkit.terminal.error(err);
    } else {
      cb(app);
    }
  });
}

function format_build(build) {
  return `**• Build Id: ${build.id}**
  ***Created:*** ${(new Date(build.created_at)).toLocaleString()}
  ***Status:*** ${build.status === "succeeded" ? "^^succeeded^^" : "!!" + build.status + "!!"}
  ***Version:*** ${(build.source_blob.commit && build.source_blob.commit.trim() !== '') ? (build.source_blob.commit.substring(0, 7) + ' -') : ''} ${build.source_blob.author ? build.source_blob.author : build.source_blob.version} ${build.source_blob.message ? build.source_blob.message.substring(0,90).replace(/\n/g,' ') : ''}\n`;
}

function format_auto_builds(auto_build) {
  return `**• ${auto_build.auto_deploy ? 'Auto Build & Deploy' : 'Auto Build'} from ${auto_build.repo}**
  ***Branch:*** ${auto_build.branch}
  ***Repo Username:*** ${auto_build.username}
  ***Wait For Status Checks:*** ${auto_build.status_check ? "Yes" : "No"}
  ***Created:*** ${(new Date(auto_build.created_at)).toLocaleString()}`;
}

function list(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  appkit.api.get('/apps/' + args.app + '/builds', 
    appkit.terminal.format_objects.bind(null, format_build, appkit.terminal.markdown('###===### No builds were found.'))); 
}

function create(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  app_or_error(appkit, args.app, (app) => {
    let payload = { org:app.organization.name, checksum:args.checksum, url:args['source-url'], repo:args.repo, sha:args.sha, branch:args.branch, version:args.version }
    appkit.api.post(JSON.stringify(payload), '/apps/' + args.app + '/builds', appkit.terminal.print);
  });
}

function rebuild(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  console.assert(args.ID && args.ID !== '', 'The build id was not provided.');
  app_or_error(appkit, args.app, (app) => {
    if(args.ID === 'latest') {
      appkit.api.get('/apps/' + args.app + '/builds', (err, builds) => {
        if(err) {
          return appkit.terminal.error(err);
        }
        if(!builds || builds.length === 0) {
          return appkit.terminal.error("No builds were found.")
        }
        args.ID = builds[builds.length - 1].id;

        let task = appkit.terminal.task(`Rebuilding **• ${args.app} (${args.ID})**`);
        task.start();
        appkit.api.put(null, '/apps/' + args.app + '/builds/' + args.ID, (err, data) => {
          if(err) {
            task.end('error');
            return appkit.terminal.error(err);
          }
          task.end('ok');
          appkit.terminal.print(err, data);
        });
      });
    } else {
      let task = appkit.terminal.task(`Rebuilding **• ${args.app} (${args.ID})**`);
      task.start();
      appkit.api.put(null, '/apps/' + args.app + '/builds/' + args.ID, (err, data) => {
        if(err) {
          task.end('error');
          return appkit.terminal.error(err);
        }
        task.end('ok');
        appkit.terminal.print(err, data);
      });
    }
  });
}

function info(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  if(!args.ID || args.ID === '') {
    args.ID = "latest";
  }
  let lookup_build_info = () => {
    appkit.api.get('/apps/' + args.app + '/builds/' + args.ID, appkit.terminal.print)
  };

  if(args.ID.toLowerCase() === "latest" || args.ID.toLowerCase() === "current") {
    appkit.api.get('/apps/' + args.app + '/builds', 
      (err, builds) => {
        if(err) {
          return appkit.terminal.error(err);
        }

        if (builds.length == 0){
          return appkit.terminal.error('No builds found.');
        }

        args.ID = builds[builds.length - 1].id;
        lookup_build_info();
      }); 
  } else {
    lookup_build_info();
  }
}

function pull_build_logs(appkit, args, callback) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  console.assert(args.ID && args.ID !== '', 'A build id was not provided and is required.');
  appkit.api.get('/apps/' + args.app + '/builds/' + args.ID, (err, data) => {
    if(err) {
      return callback(err);
    }
    appkit.api.get(data.output_stream_url, (err, logs) => {
      if(err) {
        return callback(err);
      }
      return callback(null, logs.lines.join('\n'));
    })
  });
}

function logs(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  if(!args.ID || args.ID === '') {
    args.ID = "latest";
  }
  let lookup_logs = () => {
    if(!args.tail) {
      pull_build_logs(appkit, args, (err, logs) => { 
        if(err) {
          return appkit.terminal.error(err);
        }
        process.stdout.write(logs);
      });
    } else {
      let received = {};
      let tail_logs = () => {
        pull_build_logs(appkit, args, (err, logs) => {
          if(err) {
            return appkit.terminal.error(err);
          } else {
            let lines = logs.split('\n').filter((line) => {
              if(received[line] === true) {
                return false;
              } else {
                received[line] = true;
                return true;
              }
            });
            if(lines.length > 0 && lines[lines.length - 1][lines[lines.length - 1].length - 1] !== '\n') {
              console.log(lines.join('\n'));
            } else {
              process.stdout.write(lines.join('\n'));
            }
            if(lines.indexOf("Finished: SUCCESS") > -1 || lines.indexOf("Finished: FAILURE") > -1) {
              return;
            }
            setTimeout(tail_logs, 250);
          }
        })
      };
      tail_logs();
    }
  };

  if(args.ID.toLowerCase() === "latest" || args.ID.toLowerCase() === "current") {
    appkit.api.get('/apps/' + args.app + '/builds', 
      (err, builds) => {
        if(err) {
          return appkit.terminal.error(err);
        }
        if(!builds || builds.length === 0) {
          return appkit.terminal.error("No builds were found.")
        }
        args.ID = builds[builds.length - 1].id;
        lookup_logs();
      }); 
  } else {
    lookup_logs();
  }
}

function remove_auto(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');  
  app_or_error(appkit, args.app, (app) => {
    let task = appkit.terminal.task(`Removing auto build hook for **• ${args.app}**`);
    task.start();
    appkit.api.delete('/apps/' + app.name + '/builds/auto/github', (err, data) => {
      if(err) {
        task.end('error');
        return appkit.terminal.print(err, data);
      }
      task.end('ok');
      appkit.terminal.print(err, data);
    });
  });
}


function auto(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  if(args.repo.startsWith('git://')) {
    return appkit.terminal.error('The specified repo must be an https uri.');
  }
  args.repo = args.repo.endsWith('.git') ? args.repo.substring(0, args.repo.lastIndexOf('.git')) : args.repo;
  app_or_error(appkit, args.app, (app) => {
    let payload = { 
      app:app.name, 
      repo:args.repo, 
      branch:args.branch, 
      status_check:args.status_check, 
      auto_deploy:args.auto_deploy, 
      username:args.username, 
      token:args.token 
    };
    appkit.api.post(JSON.stringify(payload), '/apps/' + app.name + '/builds/auto', (err, data) => {
      let task = appkit.terminal.task(`Creating auto build hook for **• ${args.app}**`);
      task.start();
      if(err) {
        task.end('error');
        return appkit.terminal.print(err, data);
      }
      task.end('ok');
    });
  });
}

function info_auto(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  appkit.api.get('/apps/' + args.app + '/builds/auto/github', (err, data) => {
    if(err) {
      return appkit.terminal.error(err);
    }
    console.log(appkit.terminal.markdown(format_auto_builds(data)));
  });
}

function stop(appkit, args) {
  console.assert(args.app && args.app !== '', 'An application name was not provided.');
  console.assert(args.ID && args.ID !== '', 'A build id was not provided and is required.');

  let stop_build = function() {
    appkit.api.delete('/apps/' + args.app + '/builds/' + args.ID, appkit.terminal.print);
  }

  if(args.ID.toLowerCase() === "latest" || args.ID.toLowerCase() === "current") {
    appkit.api.get('/apps/' + args.app + '/builds', 
      (err, builds) => {
        if(err) {
          return appkit.terminal.error(err);
        }
        args.ID = builds[builds.length - 1].id;
        stop_build();
      }); 
  } else {
    stop_build();
  }
}

module.exports = {
  init:function(appkit) {
    let create_build_option = {
      'app':{
        'alias':'a',
        'demand':true,
        'string':true,
        'description':'The app to act on.'
      },
      'source-url':{
        'alias':'s',
        'demand':true,
        'string':true,
        'description':'The URL for the sources, this must be a tar.gz or zip file.'
      },
      'version':{
        'alias':'v',
        'string':true,
        'description':'The version of the build or code to be built (informative only).'
      },
      'branch':{
        'alias':'b',
        'string':true,
        'description':'The branch where the sources where pulled from (informative only).'
      },
      'repo':{
        'alias':'r',
        'string':true,
        'description':'The repo where the sources were pulled (as a URL, informative only).'
      }
    }
    let require_app_option = {
      'app':{
        'alias':'a',
        'demand':true,
        'string':true,
        'description':'The app to act on.'
      }
    };
    let require_app_build_option = {
      'app':{
        'alias':'a',
        'demand':true,
        'string':true,
        'description':'The app to act on.'
      }
    };

    let require_logs_option = {
      'app':{
        'alias':'a',
        'demand':true,
        'string':true,
        'description':'The app to act on.'
      },
      'tail':{
        'alias':'t',
        'demand':false,
        'boolean':true,
        'default':false,
        'description':'Continously print out logs from build'
      }
    };
    let require_auto_build_option = {
      'app':{
        'alias':'a',
        'demand':true,
        'string':true,
        'description':'The app to enable to auto deploy on.'
      },
      'repo':{
        'alias':'r',
        'demand':true,
        'string':true,
        'description':'The repo URL (e.g., https://github.com/foo/bar)'
      },
      'branch':{
        'alias':'b',
        'default':'master',
        'string':true,
        'description':'The branch on the repo to watch and deploy from'
      },
      'status_check':{
        'boolean':true,
        'default':true,
        'description':'Whether to wait for status checks on the repo'
      },
      'auto_deploy':{
        'boolean':true,
        'default':true,
        'description':'Whether to deploy automatically after a build succeeds'
      },
      'username':{
        'alias':'u',
        'demand':true,
        'string':true,
        'description':'The username to access the repo as'
      },
      'token':{
        'alias':'t',
        'demand':true,
        'string':true,
        'description':'The token or personal access token to use when authenticating'
      }
    };
    appkit.args
      .command('builds', 'list available builds', require_app_option, list.bind(null, appkit))
      .command('builds:create', 'create a new build', create_build_option, create.bind(null, appkit))
      .command('builds:info [ID]', 'view build info, ID can be "latest" for latest build.',  require_app_option, info.bind(null, appkit))
      .command('builds:output [ID]', 'view output for a build, ID can be "latest" for latest build.', require_logs_option, logs.bind(null, appkit))
      .command('builds:auto', 'set the auto deploy hooks for your source control', require_auto_build_option, auto.bind(null, appkit))
      .command('builds:auto:info', 'get the auto build/deploy information for this app.', require_app_option, info_auto.bind(null, appkit))
      .command('builds:auto:remove', 'remove the auto build (if set)', require_app_option, remove_auto.bind(null, appkit))
      .command('builds:rebuild ID', 'rebuild a previous build.', require_app_build_option, rebuild.bind(null, appkit))
      .command('builds:stop ID', 'stop a running build', require_app_build_option, stop.bind(null, appkit))
      // aliases.
      .command('build', false, require_app_option, list.bind(null, appkit))
      .command('build:create', false, create_build_option, create.bind(null, appkit))
      .command('build:info [ID]', false,  require_app_option, info.bind(null, appkit))
      .command('build:output [ID]', false, require_logs_option, logs.bind(null, appkit))
      .command('build:out [ID]', false, require_logs_option, logs.bind(null, appkit))
      .command('builds:logs [ID]', false, require_logs_option, logs.bind(null, appkit))
      .command('builds:log [ID]', false, require_logs_option, logs.bind(null, appkit))
      .command('build:logs [ID]', false, require_logs_option, logs.bind(null, appkit))
      .command('build:log [ID]', false, require_logs_option, logs.bind(null, appkit))
      .command('build:auto', false, require_auto_build_option, auto.bind(null, appkit))
      .command('build:auto:info', false, require_app_option, info_auto.bind(null, appkit))
      .command('build:stop <ID>', false, require_app_build_option, stop.bind(null, appkit))
      .command('rebuild ID', false, require_app_build_option, rebuild.bind(null, appkit))

      .help()
  },
  update:function() {
    // do nothing.
  },
  group:'builds',
  help:'manage builds (create, list, stop, output)',
  primary:true
}
