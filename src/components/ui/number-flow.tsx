"use client";

import OriginalNumberFlow, {
  type NumberFlowElement,
  type NumberFlowProps,
} from "@number-flow/react";
import { useInView } from "motion/react";
import { forwardRef, useImperativeHandle, useRef } from "react";

export * from "@number-flow/react";

const NumberFlow = forwardRef<NumberFlowElement, NumberFlowProps>(
  function NumberFlow({ animated, ...props }, forwardedRef) {
    const elementRef = useRef<NumberFlowElement>(null);
    const inView = useInView(elementRef, { once: true });

    useImperativeHandle(forwardedRef, () => elementRef.current!, []);

    return (
      <OriginalNumberFlow
        {...props}
        ref={elementRef}
        animated={animated !== false && inView}
      />
    );
  },
);

export default NumberFlow;
