import React, { useState, useMemo, useRef } from "react";
import { CONFIGURATOR_STEPS } from "./SaunaRoomData";

const CONFIGURATOR_STEP_BY_KEY = CONFIGURATOR_STEPS.reduce((stepsByKey, step) => {
  stepsByKey[step.key] = step;
  return stepsByKey;
}, {});

const CONFIGURATOR_STEP_INDEX_BY_KEY = CONFIGURATOR_STEPS.reduce((indexesByKey, step, index) => {
  indexesByKey[step.key] = index;
  return indexesByKey;
}, {});

const getSelectedItem = (key, id) => {
  if (!id) return null;
  return CONFIGURATOR_STEP_BY_KEY[key]?.items.find((item) => item.id === id) || null;
};

const isStepSelected = (step, selections) => {
  const value = selections[step.key];
  return step.multi ? Array.isArray(value) && value.length > 0 : value !== null;
};

const isItemSelected = (step, selections, itemId) => {
  const value = selections[step.key];
  return step.multi ? Array.isArray(value) && value.includes(itemId) : value === itemId;
};

const RoomIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#af8564" strokeWidth="1.5">
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M3 14h18" />
    <path d="M7 6V4m10 2V4" />
  </svg>
);

const HeaterIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#af8564" strokeWidth="1.5">
    <path d="M12 2c1 3 4 5 4 9a4 4 0 1 1-8 0c0-4 3-6 4-9z" />
    <path d="M12 22v-4" />
  </svg>
);

const AccessoryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#af8564" strokeWidth="1.5">
    <path d="M8 2v4m8-4v4" />
    <rect x="3" y="6" width="18" height="5" rx="1" />
    <path d="M5 11v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
  </svg>
);

const EMPTY_ICONS = {
  room: RoomIcon,
  heater: HeaterIcon,
  accessory: AccessoryIcon,
};

const StepTabs = ({ currentStep, selections, onStepClick }) => (
  <div className="sawo-steps">
    {CONFIGURATOR_STEPS.map((step, index) => {
      const isActive = index === currentStep;
      const isCompleted = isStepSelected(step, selections) && !isActive;

      return (
        <button
          key={step.key}
          type="button"
          className={`sawo-step-tab${isActive ? " active" : ""}${isCompleted ? " completed" : ""}`}
          onClick={() => onStepClick(index)}
        >
          <span className="step-num">{index + 1}</span>
          <span className="step-label">{step.label}</span>
        </button>
      );
    })}
  </div>
);

const ProductGrid = ({ step, selections, onSelectItem }) => (
  <div className="sawo-cfg-grid">
    {step.items.map((item) => {
      const selected = isItemSelected(step, selections, item.id);

      return (
        <button
          key={item.id}
          type="button"
          className={`sawo-prod-card${selected ? " selected" : ""}`}
          aria-pressed={selected}
          onClick={() => onSelectItem(step.key, item.id, step.multi)}
        >
          <div className="prod-img">
            <img src={item.img} alt={item.name} loading="lazy" />
          </div>
          <div className="prod-info">
            <span className="prod-tag">{item.tag}</span>
            <div className="prod-name">{item.name}</div>
            <div className="prod-desc">{item.desc}</div>
          </div>
        </button>
      );
    })}
  </div>
);

const ConfiguratorNav = ({ currentStep, onStepClick }) => (
  <div className="sawo-cfg-nav">
    {currentStep > 0 ? (
      <button type="button" className="sawo-cfg-nav-btn prev" onClick={() => onStepClick(currentStep - 1)}>
        &larr; Back
      </button>
    ) : (
      <button type="button" className="sawo-cfg-nav-btn hidden" aria-hidden="true" tabIndex="-1">
        &larr;
      </button>
    )}

    {currentStep < CONFIGURATOR_STEPS.length - 1 ? (
      <button type="button" className="sawo-cfg-nav-btn next" onClick={() => onStepClick(currentStep + 1)}>
        Next &rarr;
      </button>
    ) : (
      <span />
    )}
  </div>
);

const SidebarItem = ({ item, onClick }) => {
  const EmptyIcon = EMPTY_ICONS[item.key];

  return (
    <button
      type="button"
      className={`sawo-sidebar-item${item.hasSelection ? " has-selection" : ""}`}
      onClick={onClick}
    >
      <div className="sb-icon">
        {item.imgSrc ? <img src={item.imgSrc} alt={item.imgAlt} /> : <EmptyIcon />}
      </div>
      <div className="sb-text">
        <div className="sb-label">{item.label}</div>
        <div className="sb-value">{item.value}</div>
      </div>
    </button>
  );
};

const ConfiguratorSidebar = ({ ctaHref, hasRoomSelection, items, onSidebarItemClick }) => (
  <div className="sawo-cfg-sidebar">
    <div className="sidebar-title">Your Selection</div>

    {items.map((item) => (
      <SidebarItem
        key={item.key}
        item={item}
        onClick={() => onSidebarItemClick(item.stepIdx)}
      />
    ))}

    {hasRoomSelection ? (
      <a
        href={ctaHref}
        className="sawo-cfg-cta"
        target="_blank"
        rel="noopener noreferrer"
      >
        Inquire About This Setup
      </a>
    ) : (
      <button type="button" className="sawo-cfg-cta disabled" disabled>
        Inquire About This Setup
      </button>
    )}
    <div className="sawo-cfg-cta-hint">
      {hasRoomSelection
        ? "Opens our contact form with your selections pre-filled"
        : "Select at least a room to continue"}
    </div>
  </div>
);

const SaunaConfigurator = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState({ room: null, heater: null, accessory: [] });
  const productsRef = useRef(null);

  const goToStep = (idx) => {
    if (idx < 0 || idx >= CONFIGURATOR_STEPS.length) return;
    setCurrentStep(idx);
  };

  const selectItem = (key, id, multi) => {
    setSelections((prev) => {
      if (multi) {
        const selectedIds = Array.isArray(prev[key]) ? prev[key] : [];
        const nextIds = selectedIds.includes(id)
          ? selectedIds.filter((selectedId) => selectedId !== id)
          : [...selectedIds, id];

        return { ...prev, [key]: nextIds };
      }

      return { ...prev, [key]: prev[key] === id ? null : id };
    });
  };

  const handleSidebarItemClick = (stepIdx) => {
    goToStep(stepIdx);
    productsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const step = CONFIGURATOR_STEPS[currentStep];
  const selectedItems = useMemo(() => {
    const accessories = selections.accessory
      .map((id) => getSelectedItem("accessory", id))
      .filter(Boolean);

    return {
      room: getSelectedItem("room", selections.room),
      heater: getSelectedItem("heater", selections.heater),
      accessories,
    };
  }, [selections]);

  const accessoryNames = useMemo(
    () => selectedItems.accessories.map((accessory) => accessory.name),
    [selectedItems.accessories]
  );

  const ctaHref = useMemo(() => {
    if (!selectedItems.room) return "#";

    const parts = ["Room: " + selectedItems.room.name];
    if (selectedItems.heater) parts.push("Heater: " + selectedItems.heater.name);
    if (accessoryNames.length > 0) parts.push("Accessories: " + accessoryNames.join(", "));

    return "https://www.sawo.com/contact/?subject=" + encodeURIComponent("Customize My Sauna - " + parts.join(" | "));
  }, [accessoryNames, selectedItems.heater, selectedItems.room]);

  const firstAccessoryImg = selectedItems.accessories[0]?.img || null;
  const hasRoomSelection = !!selectedItems.room;

  const sidebarItems = useMemo(() => [
    {
      key: "room",
      label: "Room",
      stepIdx: CONFIGURATOR_STEP_INDEX_BY_KEY.room,
      hasSelection: hasRoomSelection,
      imgSrc: selectedItems.room?.img,
      imgAlt: selectedItems.room?.name,
      value: selectedItems.room ? selectedItems.room.name : "Not selected",
    },
    {
      key: "heater",
      label: "Heater",
      stepIdx: CONFIGURATOR_STEP_INDEX_BY_KEY.heater,
      hasSelection: !!selectedItems.heater,
      imgSrc: selectedItems.heater?.img,
      imgAlt: selectedItems.heater?.name,
      value: selectedItems.heater ? selectedItems.heater.name : "Not selected",
    },
    {
      key: "accessory",
      label: "Accessories",
      stepIdx: CONFIGURATOR_STEP_INDEX_BY_KEY.accessory,
      hasSelection: accessoryNames.length > 0,
      imgSrc: firstAccessoryImg,
      imgAlt: "Accessories",
      value:
        accessoryNames.length === 0
          ? "Not selected"
          : accessoryNames.length <= 2
          ? accessoryNames.join(", ")
          : `${accessoryNames.length} items selected`,
    },
  ], [accessoryNames, firstAccessoryImg, hasRoomSelection, selectedItems.heater, selectedItems.room]);

  return (
    <div className="sawo-configurator">
      <div className="sawo-cfg-header">
        <h2 className="cfg-title">Customize Your Dream Sauna</h2>
        <p className="cfg-desc">Select your ideal room, heater, and accessories - then send us your configuration for a personalized quote.</p>
      </div>

      <StepTabs currentStep={currentStep} selections={selections} onStepClick={goToStep} />

      <div className="sawo-cfg-body">
        <div className="sawo-cfg-products" ref={productsRef}>
          <p className="sawo-cfg-step-title">{step.title}</p>
          <h3 className="sawo-cfg-step-heading">{step.heading}</h3>
          {step.multi && <div className="sawo-multi-note">You can select multiple accessories</div>}

          <ProductGrid step={step} selections={selections} onSelectItem={selectItem} />
          <ConfiguratorNav currentStep={currentStep} onStepClick={goToStep} />
        </div>

        <ConfiguratorSidebar
          ctaHref={ctaHref}
          hasRoomSelection={hasRoomSelection}
          items={sidebarItems}
          onSidebarItemClick={handleSidebarItemClick}
        />
      </div>
    </div>
  );
};

export default SaunaConfigurator;
