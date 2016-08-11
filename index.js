#!/usr/bin/env node

var chalk = require('chalk');
var clear = require('clear');
var CLI = require('clui');
var figlet = require('figlet');
var inquirer = require('inquirer');
var Preferences = require('preferences');
var Spinner = CLI.Spinner;
var GithubAPI = require('github');
var _ = require('lodash');
var git = require('simple-git')();
var touch = require('touch');
var fs = require('fs');

//Internal modules
var files = require('./lib/files');

var github = new GithubAPI({
    version: '3.0.0'
});

clear();
console.log(chalk.green(
    figlet.textSync('Lambda Init', {
        horizontalLayout: 'full'
    })
));

if (files.directoryExists('.git')) {
    console.log(chalk.red('Already a git repository!'));
    process.exit();
}

function getGibhubCredentials(callback) {
    var questions = [{
        name: 'username',
        type: 'input',
        message: 'Enter your Github username or e-mail address:',
        validate: function(value) {
            if (value.length) {
                return true;
            } else {
                return 'Please enter your Github username or e-mail address';
            }
        }
    }, {
        name: 'password',
        type: 'password',
        message: 'Enter your password:',
        valiate: function(value) {
            if (value.length) {
                return true;
            } else {
                return 'Please enter your password';
            }
        }
    }]

    inquirer.prompt(questions).then(callback);
}

function getGitHubToken(callback) {
    var prefs = new Preferences('Lambda-init');

    if (prefs.github && prefs.github.token) {
        return callback(null, prefs.github.token);
    }

    getGibhubCredentials(function(credentials){
        var status = new Spinner('Authenticating you, please wait...');
        status.start();

        github.authenticate(
            _.extend({
                type: 'basic'
            },
            credentials
            )
        );

        github.authorization.create({
            scopes: ['user', 'public_repo', 'repo', 'repo:status'],
            note: 'Lambda-init, the command line tool for intializing and managing AWS lambda functions'
        }, function (err, res) {
            status.stop();
            if (err) {
                return callback(err);
            }
            if (res.token) {
                prefs.github = {
                    token: res.token
                };
                return callback(null, res.token);
            }
            return callback();
        });
    });
}

function createRepo(callback) {
    var argv = require('minimist')(process.argv.slice(2));

    var questions = [
        {
            type: 'input',
            name: 'name',
            message: 'Enter a name for the repository:',
            default: argv._[0] || files.getCurrentDirectoryBase(),
            validate: function(value) {
                if (value.length) {
                    return true;
                } else {
                    return 'Please enter a name for the repository';
                }
            }
        },
        {
            type: 'input',
            name: 'description',
            default: argv._[1] || null,
            message: 'Optionally enter a description of the repository:'
        },
        {
            type: 'list',
            name: 'visibility',
            message: 'Public or private',
            choices: ['public', 'private'],
            default: 'public'
        }
    ];

    inquirer.prompt(questions).then(function(answers) {
        var status = new Spinner('Creating repository...');
        status.start();

        var data = {
            name: answers.name,
            description: answers.description,
            private: (answers.visibility === 'private')
        };

        github.repos.create(data, function(err, res) {
            status.stop();
            if (err) {
                return callback(err);
            } else {
                return callback(null, res.ssh_url);
            }
        });
    });
}

function createGitIgnore(callback) {
    var filelist = _.without(fs.readdirSync('.'), '.git', '.gitignore');

    if (filelist.length) {
        inquirer.prompt(
            [
                {
                    type: 'checkbox',
                    name: 'ignore',
                    message: 'Select files and/or folders you wish to ignore:',
                    choices: filelist,
                    default: ['node_modules', 'bower_components']
                }
            ]
        ).then(function(answers) {
            if (answers.ignore.length) {
                fs.writeFileSync('.gitignore', answers.ignore.join('\n'))
            } else {
                touch('.gitignore');
            }
            return callback();
        })
    } else {
        touch('.gitignore');
        return callback();
    }
}

function setupRepo(url, callback) {
    var status = new Spinner('Setting up the respository...');
    status.start();

    git.init()
        .add('.gitignore')
        .add('./*')
        .commit('Initial commit')
        .addRemote('origin', url)
        .push('origin', 'master')
        .then(function(){
            status.stop();
            return callback();
        })
}

function githubAuth(callback) {
    getGitHubToken(function(err, token) {
        if (err) {
            return callback(err);
        } else {
            github.authenticate({
                type: 'oauth',
                token: token
            });
            return callback(null, token);
        }
    });
}

githubAuth(function(err, authed) {
    if (err) {
        switch (err.code) {
            case 401:
                console.log(chalk.red('Couldn\'t log you in. Please try again.'));
                break;
            case 422:
                console.log(chalk.red('You already have an access token.'));
                break;
        }
    }

    if (authed) {
        console.log(chalk.green('Successfully authenticated!'));
        createRepo(function(err, url) {
            if (err) {
                console.log('An error has occurred');
            }
            if (url) {
                createGitIgnore(function() {
                    setupRepo(url, function(err) {
                        if(!err) {
                            console.log(chalk.green('All done!'));
                        }
                    });
                });
            }
        });
    }
});
