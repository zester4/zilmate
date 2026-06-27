import { createZilMate } from 'zilmate/server';

export const getZilMate = (sessionId: string = 'web-default') => {
  return createZilMate({
    sessionId,
  });
};
