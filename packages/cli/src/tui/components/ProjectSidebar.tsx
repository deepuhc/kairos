import React from 'react';
import { Box, Text, useInput } from 'ink';
import { colors, icons } from '../theme.js';

export interface ProjectItem {
  name: string;
  path: string;
  agentCount: number;
  isActive: boolean;
}

export interface ProjectSidebarProps {
  projects: ProjectItem[];
  onSelect: (path: string) => void;
  selectedIndex: number;
  onNavigate: (direction: 'up' | 'down') => void;
}

/**
 * Left sidebar showing all registered projects.
 *
 * KEYBOARD: Tab to focus, ↑/↓ or j/k to navigate, Enter to switch
 * MOUSE: Click project name to switch
 */
export function ProjectSidebar({
  projects,
  onSelect,
  selectedIndex,
  onNavigate,
}: ProjectSidebarProps) {
  return (
    <Box
      flexDirection="column"
      width={20}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={colors.chalk.primary}>Projects</Text>
      </Box>

      {projects.length === 0 && (
        <Text color="gray" dimColor>No projects yet</Text>
      )}

      {projects.map((project, i) => (
        <Box key={project.path}>
          <Text
            color={project.isActive ? colors.chalk.accent : 'white'}
            bold={project.isActive}
            inverse={i === selectedIndex}
          >
            {project.isActive ? '● ' : '○ '}
            {project.name.slice(0, 14)}
          </Text>
          {project.agentCount > 0 && (
            <Text color={colors.chalk.running}> ({project.agentCount})</Text>
          )}
        </Box>
      ))}
    </Box>
  );
}
