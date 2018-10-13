#!/usr/bin/env node

const meow = require('meow');
const process = require('process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { spawn } = require('child_process');
const { h, render, Component, Color } = require('ink');
const indentString = require('indent-string');

const readFile = promisify(fs.readFile);

const NUM_WORKER_OUTPUT_LINES = 10;

// =============================================================================
// Runner Functions
// =============================================================================
const WORKERS = [ ];

const waitForWorkersToExit = () => {
  return WORKERS.map((worker) => new Promise((resolve) => {
    const interval = setInterval(() => {
      if (worker.exitCode || worker.exitCode === 0) {
        clearInterval(interval);
        return resolve(worker.exitCode);
      }
    }, 50);
  }));
};

// =============================================================================
// Worker Functions
// =============================================================================
const DEFAULT_PROCFILE = `${process.cwd()}/Procfile`;
const getWorkerList = async (procfile = DEFAULT_PROCFILE) => {
  try {
    const file = await readFile(procfile, 'utf-8');
    const workerList = file.match(/(.+:.+)/ig);

    if (!workerList || !workerList.length) throw new Error(`epr: No processes found in ${procfile}`);

    return workerList.filter((s) => s.indexOf('#') === -1);
  } catch (e) {
    throw e;
  }
};
const getWorkerCwd = (procfile = DEFAULT_PROCFILE) => path.dirname(procfile);
const getWorkerName = (s) => s.split(': ').shift().trim();
const getWorkerCommand = (s) => s.split(': ').pop().trim();

// =============================================================================
// Env Functions
// =============================================================================
const DEFAULT_ENVFILE = `${process.cwd()}/.env`;
const getEnv = async (envfile = DEFAULT_ENV) => {
  try {
    const file = await readFile(envfile, 'utf-8');
    return file.split('\n').reduce((envs, s) => {
      const [key, value] = s.split('=');
      if (!key || !value) return envs;
      return {
        ...envs,
        [key]: value
      };
    }, { ...process.env });
  } catch (e) {
    throw e;
  }
};

// =============================================================================
// Child Process Functions
// =============================================================================
const runCommand = (command, cwd, env = {}) => {
  const cmd = command.split(' ').shift();
  const args = command.split(' ').splice(1);

  return spawn(cmd, args, {
    cwd,
    env
  });
};

const getMessage = (buffer) => buffer.toString('utf-8', 0, buffer.length - 1);

// =============================================================================
// Logger Component
// =============================================================================
class StreamMessages extends Component {

  constructor(props) {
    super(props);

    const { worker } = props;
    worker.stdout.on('data', (buffer) => this.logMessage(buffer));
    worker.stderr.on('data', (buffer) => this.logMessage(buffer));
    worker.on('error', (buffer) => this.logMessage(buffer));

    this.state = {
      output: ['', '', '', '', '', '', '', '', '', '']
    };
  }

  componentWillUnmount() {
    this.props.worker.kill('SIGTERM');
  }

  logMessage(buffer) {
    const { output } = this.state;

    if (output.length === NUM_WORKER_OUTPUT_LINES) {
      output.shift();
    }
    output.push(indentString(getMessage(buffer), 4));

    this.setState(() => ({
      output
    }));
  }

  render() {
    const {
      _name: name,
      _status: status,
    } = this.props.worker;
    const { output } = this.state;

    return (
      <div>
        <Color green>{status}</Color>
        <br />
        {output.map((message, i) => (
          <div key={`${name}-output-${i}`}>
            {message}
          </div>
        ))}
      </div>
    );
  }
}

// =============================================================================
// CLI Definition
// =============================================================================
const cli = meow(`
    Usage
        $ epr

    Options
        --procfile, -f Specify an alternate Procfile to load
        --env, -e Specify one or more .env files to load
`, {
    flags: {
        procfile: {
          type: 'string',
          alias: 'f'
        },
        env: {
          type: 'string',
          alias: 'e'
        },
        foldOutput: {
          type: 'boolean',
        },
    }
});

const run = (async (cli) => {
  const procfile = cli.flags.procfile && path.resolve(cli.flags.procfile);
  const envfile = cli.flags.env && path.resolve(cli.flags.env);
  const foldOutput = cli.flags.foldOutput;

  const workersList = await getWorkerList(procfile)
  const workerCwd = getWorkerCwd(procfile);
  const env = await getEnv(envfile);

  workersList.forEach((definition) => {
    const workerName = getWorkerName(definition);
    const workerCommand = getWorkerCommand(definition);
    const worker = runCommand(workerCommand, workerCwd, env);

    worker._name = workerName;
    worker._command = workerCommand;
    worker._status = `Running: ${workerName} (PID: ${worker.pid})`;

    WORKERS.push(worker);
  });

  class Log extends Component {
    render() {
      return (
        <div>
          {WORKERS.map((worker) => {
            return <StreamMessages key={worker._name} worker={worker} />
          })}
        </div>
      );
    }
  }

  render(<Log />);
})(cli);
