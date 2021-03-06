/* MIT License
 *
 * Copyright (c) 2016 schreiben
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

 "use strict";

(function(){

  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const rmdir = require('rmdir');
  const zlib = require('zlib');
  const extract = require('extract-zip');
  const tar = require('tar-fs');
  const process = require('process');
  const request = require('request');
  const ProgressBar = require('progress');
  const child_process = require('child_process');

  const version = '11.0.2';

    const jreDir = exports.jreDir = () => path.join(__dirname, '..', '..', '..', '..', 'jre');

  const fail = reason => {
    console.error(reason);
    process.exit(1);
  };

  var _arch = os.arch();
  switch (_arch) {
    case 'x64': break;
    case 'ia32': _arch = 'i586'; break;
    default:
      fail('unsupported architecture: ' + _arch);
  }
  const arch = exports.arch = () => _arch;

  var _platform = os.platform();
  var _driver;
  var _archive;
  switch (_platform) {
    case 'darwin': _platform = 'osx'; _driver = ['Contents', 'Home', 'bin', 'java']; _archive = "tar.gz"; break;
    case 'win32': _platform = 'windows'; _driver = ['bin', 'javaw.exe']; _archive = "zip"; break;
    case 'linux': _driver = ['bin', 'java']; _archive = "tar.gz"; break;
    default:
      fail('unsupported platform: ' + _platform);
  }
  const platform = exports.platform = () => _platform;

  const getDirectories = dirPath => fs.readdirSync(dirPath).filter(
    file => fs.statSync(path.join(dirPath, file)).isDirectory()
  );

  const driver = exports.driver = () => {
    var jreDirs = getDirectories(jreDir());
    if (jreDirs.length < 1)
      fail('no jre found in archive');
    var d = _driver.slice();
    d.unshift(jreDirs[0]);
    d.unshift(jreDir());
    return path.join.apply(path, d);
  };

  const getArgs = exports.getArgs = (classpath, classname, args) => {
    args = (args || []).slice();
    classpath = classpath || [];
    args.unshift(classname);
    args.unshift(classpath.join(platform() === 'windows' ? ';' : ':'));
    args.unshift('-cp');
    return args;
  };

  const spawn = exports.spawn =
    (classpath, classname, args, options) =>
      child_process.spawn(driver(), getArgs(classpath, classname, args), options);

  const spawnSync = exports.spawnSync =
    (classpath, classname, args, options) =>
      child_process.spawnSync(driver(), getArgs(classpath, classname, args), options);

  const smoketest = exports.smoketest = () => {
    const stdout = spawnSync([__dirname + '/resources'], 'Smoketest', [], { encoding: 'utf8' }).stdout
    if (stdout == null) {
       return false;
    }
    return stdout.trim() === 'No smoke!';
  }

  const url = exports.url = () =>
        'https://download.java.net/java/GA/jdk11/9/GPL/openjdk-' + version + '_' + platform() + '-' + arch() + '_bin.' + _archive;

  const install = exports.install = callback => {
    var urlStr = url();
    var options = {
            url: url(),
            rejectUnauthorized: false,
            agent: false,
            headers: {
              connection: 'keep-alive',
              'Cookie': 'gpw_e24=http://www.oracle.com/; oraclelicense=accept-securebackup-cookie'
            }
    }
    console.log("Downloading from: ", urlStr);
    callback = callback || (() => {});
    rmdir(jreDir());
    if (platform() == 'windows') {
        var zipfilename = path.join(jreDir(),'../' ,'test.zip')
        var zipfile = fs.createWriteStream(zipfilename).on('finish', function() {
            console.log('file has been written');
            extract(zipfilename, {
                dir: jreDir()
            }, function(err) {
                if (err) {
                    console.log(err)
                    callback(err)
                } else {
                    console.log(`${urlStr} downloaded and unpacked in ${jreDir()}`)
                    callback(`${urlStr} downloaded and unpacked in ${ jreDir()}`)
                }
            })
        });
        var progress = 0
        request
            .get(options)
            .on('response', res => {
                var len = parseInt(res.headers['content-length'], 10);
                var done = 0;
                var bar = new ProgressBar('  downloading and preparing JRE [:bar] :percent :etas', {
                    complete: '=',
                    incomplete: ' ',
                    width: 80,
                    total: len
                });
                res.on('data', chunk => {
                    done += chunk.length
                    var increment = Math.floor(len/10)
                    if (done > progress) {
                        console.log(`${done} ${len}`)
                        progress = progress + increment
                    }
                });
            })
            .on('error', err => {
                console.log(`problem with request: ${err.message}`);
                callback(err);
            })
            .on('end', () => {
        	    //asynchronous close. 'finish' event on stream is after file is closed
                zipfile.end()
            })
            .pipe(zipfile)
    } else {
        request
            .get(options)
            .on('response', res => {
                var len = parseInt(res.headers['content-length'], 10);
                var bar = new ProgressBar('  downloading and preparing JRE [:bar] :percent :etas', {
                    complete: '=',
                    incomplete: ' ',
                    width: 80,
                    total: len
                });
                res.on('data', chunk => bar.tick(chunk.length));
            })
            .on('error', err => {
                console.log(`problem with request: ${err.message}`);
                callback(err);
            })
            .on('end', () => {
                try{
                    if (smoketest()) callback(); else callback("Smoketest failed.");
                }catch(err){
                    callback(err);
                }
            })
            .pipe(zlib.createUnzip())
            .pipe(tar.extract(jreDir()));
    }
  };
})();
