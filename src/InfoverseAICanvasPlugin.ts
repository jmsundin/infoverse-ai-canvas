import { Plugin, App, PluginManifest, ItemView } from 'obsidian'
import {
	InfoverseAICanvasSettings,
	DEFAULT_SETTINGS
} from './settings/InfoverseAICanvasSettings'
import SettingsTab from './settings/SettingsTab'
import { Logger } from './util/logging'
import { noteGenerator } from './noteGenerator'
import { CanvasSelectionManager } from './ui/CanvasSelectionManager'
import { TooltipAction } from './ui/CanvasTooltip'
import { CanvasView } from './obsidian/canvas-patches'
import { CanvasNode } from './obsidian/canvas-internal'

/**
 * Obsidian plugin implementation.
 * Note: Canvas has no supported API. This plugin uses internal APIs that may change without notice.
 */
export class InfoverseAICanvasPlugin extends Plugin {
	settings: InfoverseAICanvasSettings
	logDebug: Logger
	private selectionManagers: Map<CanvasView, CanvasSelectionManager> = new Map()

	constructor(app: App, pluginManifest: PluginManifest, pluginPath: string) {
		super(app, pluginManifest)
	}

	async onload() {
		await this.loadSettings()

		this.logDebug = this.settings.debug
			? (message?: unknown, ...optionalParams: unknown[]) =>
				console.debug('Chat Stream: ' + message, ...optionalParams)
			: () => { }

		this.logDebug('Debug logging enabled')

		const generator = noteGenerator(this.app, this.settings, this.logDebug)

		this.addSettingTab(new SettingsTab(this.app, this))

		// Setup canvas tooltip actions
		const tooltipActions: TooltipAction[] = [
			{
				id: 'hierarchical-mindmap',
				icon: 'git-branch',
				tooltip: 'Create hierarchical mindmap',
				action: (node: CanvasNode) => generator.generateHierarchicalMindmap()
			},
			{
				id: 'radial-mindmap',
				icon: 'circle-dot',
				tooltip: 'Create radial mindmap',
				action: (node: CanvasNode) => generator.generateRadialMindmap()
			},
			{
				id: 'single-response',
				icon: 'message-square',
				tooltip: 'Generate single AI response',
				action: (node: CanvasNode) => generator.generateSingleAIResponse()
			}
		]

		// Monitor for canvas views
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.setupCanvasTooltips(tooltipActions)
			})
		)

		// Initial setup
		this.setupCanvasTooltips(tooltipActions)

		this.addCommand({
			id: 'generate-note',
			name: 'Generate AI note',
			callback: () => {
				generator.generateNote()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'G'
				}
			]
		})

		this.addCommand({
			id: 'next-note',
			name: 'Create next note',
			callback: () => {
				generator.nextNote()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'N'
				}
			]
		})

		this.addCommand({
			id: 'generate-mindmap',
			name: 'Generate AI mindmap',
			callback: () => {
				generator.generateMindmapNote()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'M'
				}
			]
		})

		this.addCommand({
			id: 'split-markdown-hierarchical',
			name: 'Split markdown into hierarchical notes',
			callback: () => {
				generator.splitMarkdownHierarchical()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'S'
				}
			]
		})

		// Add new commands for tooltip actions
		this.addCommand({
			id: 'generate-hierarchical-mindmap',
			name: 'Generate hierarchical mindmap',
			callback: () => {
				generator.generateHierarchicalMindmap()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'H'
				}
			]
		})

		this.addCommand({
			id: 'generate-radial-mindmap',
			name: 'Generate radial mindmap',
			callback: () => {
				generator.generateRadialMindmap()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'R'
				}
			]
		})

		this.addCommand({
			id: 'generate-single-response',
			name: 'Generate single AI response',
			callback: () => {
				generator.generateSingleAIResponse()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'A'
				}
			]
		})

		console.log('InfoverseAICanvasPlugin: commands and tooltips added')
	}

	private setupCanvasTooltips(actions: TooltipAction[]) {
		const activeView = this.app.workspace.getActiveViewOfType(ItemView) as CanvasView | null

		if (activeView && activeView.getViewType() === 'canvas') {
			// Check if we already have a manager for this view
			if (!this.selectionManagers.has(activeView)) {
				try {
					const manager = new CanvasSelectionManager(activeView, actions)
					this.selectionManagers.set(activeView, manager)
					this.logDebug('Setup tooltip for canvas view')
				} catch (error) {
					this.logDebug('Failed to setup canvas tooltip:', error)
				}
			}
		}

		// Clean up managers for views that are no longer active
		const activeViews = new Set(this.app.workspace.getLeavesOfType('canvas').map(leaf => leaf.view))
		for (const [view, manager] of this.selectionManagers.entries()) {
			if (!activeViews.has(view)) {
				manager.destroy()
				this.selectionManagers.delete(view)
				this.logDebug('Cleaned up tooltip for closed canvas view')
			}
		}
	}

	async onunload() {
		// Clean up all selection managers
		for (const manager of this.selectionManagers.values()) {
			manager.destroy()
		}
		this.selectionManagers.clear()
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}
}
