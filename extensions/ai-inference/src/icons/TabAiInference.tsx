import React from 'react';

type TabAiInferenceProps = React.SVGProps<SVGSVGElement>;

export const TabAiInference = (props: TabAiInferenceProps) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g
      fill="none"
      fillRule="evenodd"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect
        x="5.25"
        y="5.5"
        width="9.5"
        height="9.5"
        rx="2.25"
      />
      <circle
        cx="8.4"
        cy="9"
        r="0.85"
      />
      <circle
        cx="11.2"
        cy="12"
        r="0.85"
      />
      <circle
        cx="12.7"
        cy="8.3"
        r="0.85"
      />
      <path d="M8.95 9.25 11.35 11.65M9.05 8.8l3.05-.4M11.65 11.2l.75-2.15" />
      <circle
        cx="17.5"
        cy="5.6"
        r="0.85"
      />
      <circle
        cx="16.9"
        cy="15.95"
        r="0.85"
      />
      <circle
        cx="4"
        cy="16.6"
        r="0.85"
      />
      <path d="M14.15 7.2 16.35 6.05M14.3 13.85l1.9 1.3M5.7 13.7 4.7 15.2" />
    </g>
  </svg>
);

export default TabAiInference;
