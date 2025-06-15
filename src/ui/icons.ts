export const BUBBLE_CLUSTER_ICON_NAME = 'bubble-cluster'

export const BUBBLE_CLUSTER_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
	<g stroke-width="1.5" stroke="currentColor">
          <!-- Lines -->
          <line x1="10" y1="12" x2="4" y2="5" />
          <line x1="10" y1="12" x2="18" y2="7" />
          <line x1="10" y1="12" x2="16" y2="19" />

          <!-- Nodes -->
          <!-- Central Node (hollow) -->
          <circle cx="10" cy="12" r="3" fill="currentColor"/>

          <!-- Outer Nodes (filled) -->
          <g fill="currentColor" stroke-width="1">
              <circle cx="4" cy="5" r="2.5" />
              <circle cx="18" cy="7" r="2.5" />
              <circle cx="16" cy="19" r="2.5" />
          </g>
</svg>`
