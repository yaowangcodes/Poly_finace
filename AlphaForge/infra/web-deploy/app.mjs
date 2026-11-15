import { App } from 'aws-cdk-lib';
import { readConfig } from './config.mjs';
import { createStacks } from './stacks.mjs';
createStacks(new App(), readConfig());
