import test from 'node:test';
import assert from 'node:assert/strict';
import {healthProblem,parseDevices,findAdb} from '../../scripts/launcher-utils.mjs';
test('phone launcher accepts only an identified compatible healthy Farmconnect backend',()=>{
 assert.equal(healthProblem({application:'Farmconnect',apiVersion:1,status:'ok',database:'connected'}),null);
 for(const response of [null,{},'<html>',{status:'ok',database:'connected'},{application:'Farmconnect',apiVersion:2}])assert.match(healthProblem(response),/older or different/);
 assert.match(healthProblem({application:'Farmconnect',apiVersion:1,status:'error',database:'offline'}),/database/);
});
test('phone launcher distinguishes authorization and multiple-device conditions without guessing a phone',()=>{
 assert.deepEqual(parseDevices('List of devices attached\r\nabc\tdevice\r\ndef\tunauthorized\r\nemulator-5554\toffline\r\n'),[{id:'abc',state:'device'},{id:'def',state:'unauthorized'},{id:'emulator-5554',state:'offline'}]);
 assert.deepEqual(parseDevices('* daemon started successfully *\nList of devices attached\n'),[]);
 assert.equal(findAdb({},()=>true),null);assert.match(findAdb({ANDROID_SDK_ROOT:'test-sdk'},()=>true),/platform-tools/);
});
