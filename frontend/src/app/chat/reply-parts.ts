import { Pipe, PipeTransform } from '@angular/core';
import { ReplyParts, splitReply } from '../openui/reply';

/** A reply of the agent, as the text to read and the interface to draw. */
@Pipe({ name: 'replyParts' })
export class ReplyPartsPipe implements PipeTransform {
  transform(content: string, streaming: boolean): ReplyParts {
    return splitReply(content, streaming);
  }
}
