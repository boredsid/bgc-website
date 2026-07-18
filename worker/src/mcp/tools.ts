import type { McpTool } from './types';
import { eventsTools } from './events-tools';
import { libraryTools } from './library-tools';
import { infoTools } from './info-tools';
import { writeTools } from './write-tools';

export const ALL_TOOLS: McpTool[] = [...eventsTools, ...libraryTools, ...infoTools, ...writeTools];
