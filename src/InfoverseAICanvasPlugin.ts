import { Plugin, App, PluginManifest, ItemView, addIcon } from 'obsidian'
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
import {
	BUBBLE_CLUSTER_ICON_NAME,
	BUBBLE_CLUSTER_SVG
} from './ui/icons'

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

		addIcon(BUBBLE_CLUSTER_ICON_NAME, BUBBLE_CLUSTER_SVG)

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
				id: 'single-response',
				icon: 'message-square',
				tooltip: 'Generate single AI response',
				action: (node: CanvasNode) => generator.generateNote()
			},
			{
				id: 'bubble-cluster-mindmap',
				icon: BUBBLE_CLUSTER_ICON_NAME,
				tooltip: 'Generate a mindmap',
				action: (node: CanvasNode) => generator.generateMindmap()
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
				generator.generateMindmap()
			},
			hotkeys: [
				{
					modifiers: ['Alt', 'Shift'],
					key: 'M'
				}
			]
		})

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
