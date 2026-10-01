import React from 'react';

export const ExchangeTag: React.FC<{ symbol: string }> = ({ symbol }) => {
  let badgeText = "US Exchange";
  let badgeClass = "exchange-badge-us";

  if (["RWE", "SAP"].includes(symbol)) {
    badgeText = "XETRA";
    badgeClass = "exchange-badge-xetra";
  } else if (["SGO", "ENGI", "ORSTED"].includes(symbol)) {
    badgeText = "EURONEXT";
    badgeClass = "exchange-badge-euronext";
  }

  return (
    <span className={`exchange-tag ${badgeClass} text-xs px-2 py-0.5 rounded border ml-2 font-mono font-bold tracking-wider inline-block select-none align-middle transition-colors duration-150`}>
      {badgeText}
    </span>
  );
};
