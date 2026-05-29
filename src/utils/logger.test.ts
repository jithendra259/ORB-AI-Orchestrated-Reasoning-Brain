import * as vscode from 'vscode';
import { OutputChannelOrbLogger } from './logger';

describe('OutputChannelOrbLogger', () => {
  let mockOutputChannel: any;
  let logger: OutputChannelOrbLogger;

  beforeEach(() => {
    mockOutputChannel = {
      appendLine: jest.fn(),
      clear: jest.fn(),
      show: jest.fn()
    };
    logger = new OutputChannelOrbLogger(mockOutputChannel as any);
  });

  it('logs info messages correctly', () => {
    logger.info('Test message');
    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[INFO\] Test message/));
  });

  it('logs warn messages correctly', () => {
    logger.warn('Warning here');
    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[WARN\] Warning here/));
  });

  it('logs error messages correctly', () => {
    logger.error('Error occurred');
    expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringMatching(/\[.*\] \[ERROR\] Error occurred/));
  });

  it('formats string details correctly', () => {
    logger.info('Message', 'Detail string');
    expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(2);
    expect(mockOutputChannel.appendLine).toHaveBeenNthCalledWith(2, 'Detail string');
  });

  it('formats object details as JSON', () => {
    logger.info('Message', { key: 'value' });
    expect(mockOutputChannel.appendLine).toHaveBeenCalledTimes(2);
    expect(mockOutputChannel.appendLine).toHaveBeenNthCalledWith(2, JSON.stringify({ key: 'value' }, null, 2));
  });

  it('formats Error details correctly', () => {
    const error = new Error('Something went wrong');
    error.stack = 'ErrorStack';
    logger.error('Error msg', error);
    expect(mockOutputChannel.appendLine).toHaveBeenNthCalledWith(2, 'Error: Something went wrong\nErrorStack');
  });

  it('delegates clear and show', () => {
    logger.clear();
    expect(mockOutputChannel.clear).toHaveBeenCalled();

    logger.show();
    expect(mockOutputChannel.show).toHaveBeenCalledWith(true);
  });
});
