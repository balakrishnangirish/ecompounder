import React from "react";

export default function Step({
  label,
  active,
  currentStep
}: {
  label: string;
  active: boolean;
  currentStep: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2 h-2 rounded-full ${
          currentStep
            ? "bg-blue-600"
            : active
            ? "bg-slate-400"
            : "bg-slate-200"
        }`}
      />
      <span
        className={`text-sm ${
          currentStep
            ? "text-blue-600 font-semibold"
            : active
            ? "text-slate-600"
            : "text-slate-400"
        }`}
      >
        {label}
      </span>
    </div>
  );
}