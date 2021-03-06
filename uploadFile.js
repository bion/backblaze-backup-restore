require('dotenv').config();

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const request = require('request');

const logger = require('./logger');
const getBucketId = require('./getBucketId');
const encryptDecrypt = require('./encryptDecrypt');
const fileShaSum = require('./fileShaSum');
const progressBar = require('./progressBar');

const files = [];

function storageKey(file){
  return encryptDecrypt.encrypt(file);
}

function exclude(file){
  if(file == 'lost+found'){
    return true;
  }
  return false;
}

function uploadFile(options, file){
  return function(callback){
    logger.info('***** beginning work on: ', file);
    fileShaSum(file, 'sha256', function(err, originalSha256){
      logger.info('generating encrypted name for: ', file);
      const originalPathEncrypted = encryptDecrypt.encrypt(file);
      logger.info('encrypted name for file: ', file, originalPathEncrypted);
      const workingFile = '/tmp/'+originalPathEncrypted;
      const reader = fs.createReadStream(file);
      const zip = zlib.createGzip();
      const writer = fs.createWriteStream(workingFile);
      logger.info('reading, zipping, encrypting and writing working file: ', file, workingFile);
      reader.pipe(zip).pipe(encryptDecrypt.createCipher()).pipe(writer).on('finish', function(){
        zip.end();
        writer.end();
        logger.info('zipped and encrypted file written: ', workingFile)
        fileShaSum(workingFile, 'sha1', function(err, sha1){
          logger.info('generated sha1 for: ', workingFile, sha1);
          const contentLength = fs.statSync(workingFile).size;
          logger.info('content length for: ', workingFile, contentLength);
          const url = options.apiUrl + '/b2api/v1/b2_get_upload_url';
          logger.info('getting upload authorization for: ', file);
          const bar = progressBar('uploading', contentLength);
          getBucketId(options, function(err, options){
            request({
              json: true,
              url: url,
              headers: {
                'Authorization': options.authorizationToken
              },
              qs: {
                bucketId: options.bucketId
              }
            }, function(err, response, data){
              if(err){ throw new Error(err) }
              logger.info('received upload authorization for: ', file);
              const uploadToken = data.authorizationToken;
              const uploadUrl = data.uploadUrl;
              logger.info('uploading file: ', file);
              const w = fs.createReadStream(workingFile)
              w.on('data', function(chunk){
                bar.tick(chunk.length);
              }).pipe(request.post(uploadUrl, {
                headers: {
                  'Authorization': uploadToken,
                  'X-Bz-File-Name': storageKey(file),
                  'X-Bz-Content-Sha1': sha1,
                  'Content-Length': contentLength,
                  'Content-Type': 'application/octet-stream',
                  'X-Bz-Info-Original-Sha256': originalSha256
                }
              }).on('error', function(err){
                logger.error('error uploading file: ', file);
                logger.info('removing working file: ', workingFile);
                fs.unlinkSync(workingFile);
                callback(err);
              }).on('end', function(){
                logger.info('removing working file: ', workingFile);
                fs.unlinkSync(workingFile);
                logger.info('upload complete: ', file);
                callback();
              }));
            });
          });
        });
      });
    });
  };
}

module.exports = uploadFile;
