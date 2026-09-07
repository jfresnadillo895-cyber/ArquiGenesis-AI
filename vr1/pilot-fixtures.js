window.VR1_PILOT_ORGANISM = {
  "id": "ORG-SYNTHETIC-001",
  "nombre": "Proyecto sintético Trenque Lauquen",
  "tipo": "proyecto",
  "ficha": {
    "diagnostico": "El proyecto se encuentra en estudio preliminar.",
    "proximo": "Revisar indicadores urbanísticos."
  },
  "ficha_historial": [],
  "recuerdos": [
    {
      "id": "rec_fixture_001",
      "title": "Inicio del estudio",
      "createdAt": "2026-08-17T12:00:00.000Z",
      "source": "core",
      "field": [
        "diagnostico"
      ],
      "before": {
        "diagnostico": ""
      },
      "after": {
        "diagnostico": "El proyecto se encuentra en estudio preliminar."
      },
      "summary": "Diagnóstico: El proyecto se encuentra en estudio preliminar.",
      "organismVersion": 1,
      "originRef": {
        "propuestaId": "p_fixture_001",
        "turno": 1,
        "resuelto_como": "confirmada"
      }
    }
  ],
  "hitos": [],
  "horizonte": null,
  "principios": [],
  "diagnosticos_pro": [
    {
      "origen": "urban_pro",
      "version": 1,
      "fecha": "2026-08-17T11:00:00.000Z",
      "resumen": "Antecedente urbano legado verificable como contexto, no como evidencia."
    }
  ],
  "evaluaciones_negocio_pro": [
    {
      "version": 1,
      "fecha": "2026-08-17T11:30:00.000Z",
      "resumen": "Antecedente de negocio legado."
    }
  ],
  "_sv": {
    "version": 7
  }
};
window.VR1_PILOT_RESULT = {
  "case_id": "EVR-TL-001",
  "project_version": "1.0",
  "corpus_cutoff": "2026-08-17",
  "status": "preliminary_conditional_compatibility",
  "verification_level": "V1",
  "reasoning_level": "R1",
  "traceability_level": "T2",
  "calculations": {
    "FOS": {
      "formula": "ground_floor_footprint_m2 / lot_area_m2",
      "inputs": {
        "ground_floor_footprint_m2": 174,
        "lot_area_m2": 300
      },
      "unit": "ratio",
      "value": 0.58
    },
    "FOT": {
      "formula": "total_floor_area_m2 / lot_area_m2",
      "inputs": {
        "total_floor_area_m2": 324,
        "lot_area_m2": 300
      },
      "unit": "ratio",
      "value": 1.08
    },
    "CAS": {
      "formula": "absorbent_surface_m2 / lot_area_m2",
      "inputs": {
        "absorbent_surface_m2": 66,
        "lot_area_m2": 300
      },
      "unit": "ratio",
      "value": 0.22
    }
  },
  "claims": [
    {
      "claim_id": "A1",
      "content": "La parcela sintética tiene 300 m²",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A1",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "lot_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A2",
      "content": "El proyecto ocupa 174 m² en planta baja",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A2",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "ground_floor_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A3",
      "content": "La superficie cubierta total es 324 m²",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A3",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "total_floor_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A4",
      "content": "La superficie absorbente es 66 m²",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A4",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "absorbent_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A5",
      "content": "La Ordenanza 5368/2022 asigna R3 a una fracción de Chacra 221",
      "cognitive_type": "data",
      "epistemic_state": "supported",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A5",
          "type": "official_document_fragment",
          "source_id": "SRC-001",
          "fragment_id": "ORD-5368-ART-1-2",
          "role": "zoning_change",
          "integrity": "verified_against_snapshot"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A6",
      "content": "La parcela sintética pertenece a esa fracción",
      "cognitive_type": "hypothesis",
      "epistemic_state": "unverified",
      "domain": "normative_project",
      "support": [],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A7",
      "content": "Los límites publicados son FOS 0,6; FOT 1,2; CAS 0,2",
      "cognitive_type": "data",
      "epistemic_state": "supported",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A7",
          "type": "official_document_fragment",
          "source_id": "SRC-001",
          "fragment_id": "ORD-5368-ART-2",
          "role": "normative_limits",
          "integrity": "verified_against_snapshot"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A8",
      "content": "Los cálculos convencionales producen FOS 0,58; FOT 1,08; CAS 0,22",
      "cognitive_type": "inference",
      "epistemic_state": "supported",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A8",
          "type": "calculation",
          "source_id": "CALC-EVR-TL-001",
          "role": "calculated_indicators",
          "values": {
            "FOS": 0.58,
            "FOT": 1.08,
            "CAS": 0.22
          }
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": {
        "kind": "deterministic_calculation_or_comparison"
      }
    },
    {
      "claim_id": "A9",
      "content": "Los valores calculados satisfacen los límites localizados",
      "cognitive_type": "inference",
      "epistemic_state": "conditional",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A9",
          "type": "calculation_comparison",
          "source_id": "CALC-EVR-TL-001",
          "role": "limit_comparison"
        }
      ],
      "conditions": [
        "La parcela debe pertenecer a la fracción regulada.",
        "Las fórmulas convencionales deben resultar aplicables.",
        "Los límites localizados deben conservar vigencia para el alcance declarado."
      ],
      "contradictions": [],
      "operation": {
        "kind": "deterministic_calculation_or_comparison"
      }
    },
    {
      "claim_id": "A10",
      "content": "La morfología PB+1 coincide con la hoja R3 localizada",
      "cognitive_type": "inference",
      "epistemic_state": "conditional",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A10",
          "type": "official_document_fragment",
          "source_id": "SRC-002",
          "fragment_id": "R3-MORPHOLOGY",
          "role": "morphology_limit",
          "integrity": "logical_snapshot_pending_original"
        }
      ],
      "conditions": [
        "Debe conservarse la integridad y aplicabilidad de la hoja R3 localizada."
      ],
      "contradictions": [],
      "operation": {
        "kind": "deterministic_calculation_or_comparison"
      }
    },
    {
      "claim_id": "A11",
      "content": "El proyecto tiene compatibilidad normativa integral",
      "cognitive_type": "understanding",
      "epistemic_state": "unverified",
      "domain": "normative_project",
      "support": [],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A12",
      "content": "Puede declararse compatibilidad preliminar condicionada",
      "cognitive_type": "understanding",
      "epistemic_state": "supported",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A12",
          "type": "bounded_synthesis",
          "source_id": "EVR-TL-001",
          "role": "preliminary_conclusion"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    }
  ],
  "unresolved": [
    "official_parcel_location",
    "exhaustive_normative_validity",
    "official_operational_formulas",
    "complete_use_and_building_requirements",
    "professional_review",
    "authority_validation",
    "annex_ii_original"
  ],
  "issues": [],
  "forbidden_closure": true,
  "human_output": "Compatibilidad preliminar condicionada — V1\nCon las fórmulas convencionales utilizadas, el proyecto presenta FOS 0,58, FOT 1,08 y CAS 0,22, valores compatibles con los indicadores R3 localizados. No se confirmó la vigencia integral del corpus, la aplicabilidad oficial de todas las fórmulas ni la cobertura completa. El análisis no constituye revisión profesional ni aprobación municipal. Pendientes: ubicación parcelaria oficial, vigencia normativa exhaustiva, fórmulas operativas oficiales, requisitos completos de uso y edificación, revisión profesional, validación de autoridad, original físico del Anexo II.",
  "epistemic_records": [
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A1",
      "claim": {
        "claim_id": "A1",
        "content": "La parcela sintética tiene 300 m²",
        "cognitive_type": "data",
        "epistemic_state": "declared",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A1",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A1",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "lot_area"
        }
      ],
      "dependencies": [],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A2",
      "claim": {
        "claim_id": "A2",
        "content": "El proyecto ocupa 174 m² en planta baja",
        "cognitive_type": "data",
        "epistemic_state": "declared",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A2",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A2",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "ground_floor_area"
        }
      ],
      "dependencies": [],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A3",
      "claim": {
        "claim_id": "A3",
        "content": "La superficie cubierta total es 324 m²",
        "cognitive_type": "data",
        "epistemic_state": "declared",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A3",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A3",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "total_floor_area"
        }
      ],
      "dependencies": [],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A4",
      "claim": {
        "claim_id": "A4",
        "content": "La superficie absorbente es 66 m²",
        "cognitive_type": "data",
        "epistemic_state": "declared",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A4",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A4",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "absorbent_area"
        }
      ],
      "dependencies": [],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A5",
      "claim": {
        "claim_id": "A5",
        "content": "La Ordenanza 5368/2022 asigna R3 a una fracción de Chacra 221",
        "cognitive_type": "data",
        "epistemic_state": "supported",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A5",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A5",
          "type": "official_document_fragment",
          "source_id": "SRC-001",
          "fragment_id": "ORD-5368-ART-1-2",
          "role": "zoning_change",
          "integrity": "verified_against_snapshot"
        }
      ],
      "dependencies": [],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A6",
      "claim": {
        "claim_id": "A6",
        "content": "La parcela sintética pertenece a esa fracción",
        "cognitive_type": "hypothesis",
        "epistemic_state": "unverified",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A6",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [],
      "dependencies": [],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A7",
      "claim": {
        "claim_id": "A7",
        "content": "Los límites publicados son FOS 0,6; FOT 1,2; CAS 0,2",
        "cognitive_type": "data",
        "epistemic_state": "supported",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A7",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A7",
          "type": "official_document_fragment",
          "source_id": "SRC-001",
          "fragment_id": "ORD-5368-ART-2",
          "role": "normative_limits",
          "integrity": "verified_against_snapshot"
        }
      ],
      "dependencies": [
        {
          "dependency_id": "DEP-A7-1",
          "claim_id": "SRC-001",
          "required_state": "supported",
          "critical": false
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A8",
      "claim": {
        "claim_id": "A8",
        "content": "Los cálculos convencionales producen FOS 0,58; FOT 1,08; CAS 0,22",
        "cognitive_type": "inference",
        "epistemic_state": "supported",
        "domain": "normative_project",
        "conditions": [],
        "operation": {
          "kind": "deterministic_calculation_or_comparison"
        }
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A8",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A8",
          "type": "calculation",
          "source_id": "CALC-EVR-TL-001",
          "role": "calculated_indicators",
          "values": {
            "FOS": 0.58,
            "FOT": 1.08,
            "CAS": 0.22
          }
        }
      ],
      "dependencies": [],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A9",
      "claim": {
        "claim_id": "A9",
        "content": "Los valores calculados satisfacen los límites localizados",
        "cognitive_type": "inference",
        "epistemic_state": "conditional",
        "domain": "normative_project",
        "conditions": [
          "La parcela debe pertenecer a la fracción regulada.",
          "Las fórmulas convencionales deben resultar aplicables.",
          "Los límites localizados deben conservar vigencia para el alcance declarado."
        ],
        "operation": {
          "kind": "deterministic_calculation_or_comparison"
        }
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A9",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A9",
          "type": "calculation_comparison",
          "source_id": "CALC-EVR-TL-001",
          "role": "limit_comparison"
        }
      ],
      "dependencies": [
        {
          "dependency_id": "DEP-A9-1",
          "claim_id": "A6",
          "required_state": "supported",
          "critical": true
        },
        {
          "dependency_id": "DEP-A9-2",
          "claim_id": "A7",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A9-3",
          "claim_id": "A8",
          "required_state": "supported",
          "critical": false
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A10",
      "claim": {
        "claim_id": "A10",
        "content": "La morfología PB+1 coincide con la hoja R3 localizada",
        "cognitive_type": "inference",
        "epistemic_state": "conditional",
        "domain": "normative_project",
        "conditions": [
          "Debe conservarse la integridad y aplicabilidad de la hoja R3 localizada."
        ],
        "operation": {
          "kind": "deterministic_calculation_or_comparison"
        }
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A10",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A10",
          "type": "official_document_fragment",
          "source_id": "SRC-002",
          "fragment_id": "R3-MORPHOLOGY",
          "role": "morphology_limit",
          "integrity": "logical_snapshot_pending_original"
        }
      ],
      "dependencies": [
        {
          "dependency_id": "DEP-A10-1",
          "claim_id": "SRC-002",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A10-2",
          "claim_id": "PROJECT-MORPHOLOGY",
          "required_state": "supported",
          "critical": false
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A11",
      "claim": {
        "claim_id": "A11",
        "content": "El proyecto tiene compatibilidad normativa integral",
        "cognitive_type": "understanding",
        "epistemic_state": "unverified",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A11",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [],
      "dependencies": [
        {
          "dependency_id": "DEP-A11-1",
          "claim_id": "A9",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A11-2",
          "claim_id": "A10",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A11-3",
          "claim_id": "EXHAUSTIVE-VALIDITY",
          "required_state": "supported",
          "critical": true
        },
        {
          "dependency_id": "DEP-A11-4",
          "claim_id": "COMPLETE-COVERAGE",
          "required_state": "supported",
          "critical": true
        },
        {
          "dependency_id": "DEP-A11-5",
          "claim_id": "PROFESSIONAL-REVIEW",
          "required_state": "supported",
          "critical": true
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A12",
      "claim": {
        "claim_id": "A12",
        "content": "Puede declararse compatibilidad preliminar condicionada",
        "cognitive_type": "understanding",
        "epistemic_state": "supported",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A12",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T10:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A12",
          "type": "bounded_synthesis",
          "source_id": "EVR-TL-001",
          "role": "preliminary_conclusion"
        }
      ],
      "dependencies": [
        {
          "dependency_id": "DEP-A12-1",
          "claim_id": "A5",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A12-2",
          "claim_id": "A7",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A12-3",
          "claim_id": "A8",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A12-4",
          "claim_id": "EXPLICIT-LIMITS",
          "required_state": "supported",
          "critical": false
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 1,
        "revision_of": null,
        "supersedes": null,
        "current": true,
        "change_reason": null
      }
    }
  ],
  "provenance": {
    "runtime": "comprender-vr1-evr-tl-001@2.0.0",
    "deterministic": true,
    "network_used": false,
    "input_sha256": "455ac32cbd6c694d9dc8856f9f4378636a3d7e50d138181d34dddd660474cca0"
  },
  "validation": {
    "ok": true,
    "errors": []
  }
};
window.VR1_PILOT_CONTRADICTION = {
  "case_id": "EVR-TL-001",
  "project_version": "1.0",
  "corpus_cutoff": "2026-08-17",
  "status": "reopened_due_to_normative_change",
  "verification_level": "V1",
  "reasoning_level": "R1",
  "traceability_level": "T2",
  "calculations": {
    "FOS": {
      "formula": "ground_floor_footprint_m2 / lot_area_m2",
      "inputs": {
        "ground_floor_footprint_m2": 174,
        "lot_area_m2": 300
      },
      "unit": "ratio",
      "value": 0.58
    },
    "FOT": {
      "formula": "total_floor_area_m2 / lot_area_m2",
      "inputs": {
        "total_floor_area_m2": 324,
        "lot_area_m2": 300
      },
      "unit": "ratio",
      "value": 1.08
    },
    "CAS": {
      "formula": "absorbent_surface_m2 / lot_area_m2",
      "inputs": {
        "absorbent_surface_m2": 66,
        "lot_area_m2": 300
      },
      "unit": "ratio",
      "value": 0.22
    }
  },
  "claims": [
    {
      "claim_id": "A1",
      "content": "La parcela sintética tiene 300 m²",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A1",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "lot_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A2",
      "content": "El proyecto ocupa 174 m² en planta baja",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A2",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "ground_floor_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A3",
      "content": "La superficie cubierta total es 324 m²",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A3",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "total_floor_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A4",
      "content": "La superficie absorbente es 66 m²",
      "cognitive_type": "data",
      "epistemic_state": "declared",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A4",
          "type": "declared_data",
          "source_id": "PRJ-TL-001",
          "role": "absorbent_area"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A5",
      "content": "La Ordenanza 5368/2022 asigna R3 a una fracción de Chacra 221",
      "cognitive_type": "data",
      "epistemic_state": "supported",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A5",
          "type": "official_document_fragment",
          "source_id": "SRC-001",
          "fragment_id": "ORD-5368-ART-1-2",
          "role": "zoning_change",
          "integrity": "verified_against_snapshot"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A6",
      "content": "La parcela sintética pertenece a esa fracción",
      "cognitive_type": "hypothesis",
      "epistemic_state": "unverified",
      "domain": "normative_project",
      "support": [],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A7",
      "content": "Los límites publicados son FOS 0,6; FOT 1,2; CAS 0,2",
      "cognitive_type": "data",
      "epistemic_state": "conflict",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A7",
          "type": "official_document_fragment",
          "source_id": "SRC-001",
          "fragment_id": "ORD-5368-ART-2",
          "role": "normative_limits",
          "integrity": "verified_against_snapshot"
        }
      ],
      "conditions": [],
      "contradictions": [
        "LATER_NORMATIVE_CONTRADICTION"
      ],
      "operation": null
    },
    {
      "claim_id": "A8",
      "content": "Los cálculos convencionales producen FOS 0,58; FOT 1,08; CAS 0,22",
      "cognitive_type": "inference",
      "epistemic_state": "supported",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A8",
          "type": "calculation",
          "source_id": "CALC-EVR-TL-001",
          "role": "calculated_indicators",
          "values": {
            "FOS": 0.58,
            "FOT": 1.08,
            "CAS": 0.22
          }
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": {
        "kind": "deterministic_calculation_or_comparison"
      }
    },
    {
      "claim_id": "A9",
      "content": "Los valores calculados satisfacen los límites localizados",
      "cognitive_type": "inference",
      "epistemic_state": "unverified",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A9",
          "type": "calculation_comparison",
          "source_id": "CALC-EVR-TL-001",
          "role": "limit_comparison"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": {
        "kind": "deterministic_calculation_or_comparison"
      }
    },
    {
      "claim_id": "A10",
      "content": "La morfología PB+1 coincide con la hoja R3 localizada",
      "cognitive_type": "inference",
      "epistemic_state": "conditional",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A10",
          "type": "official_document_fragment",
          "source_id": "SRC-002",
          "fragment_id": "R3-MORPHOLOGY",
          "role": "morphology_limit",
          "integrity": "logical_snapshot_pending_original"
        }
      ],
      "conditions": [
        "Debe conservarse la integridad y aplicabilidad de la hoja R3 localizada."
      ],
      "contradictions": [],
      "operation": {
        "kind": "deterministic_calculation_or_comparison"
      }
    },
    {
      "claim_id": "A11",
      "content": "El proyecto tiene compatibilidad normativa integral",
      "cognitive_type": "understanding",
      "epistemic_state": "unverified",
      "domain": "normative_project",
      "support": [],
      "conditions": [],
      "contradictions": [],
      "operation": null
    },
    {
      "claim_id": "A12",
      "content": "Puede declararse compatibilidad preliminar condicionada",
      "cognitive_type": "understanding",
      "epistemic_state": "unverified",
      "domain": "normative_project",
      "support": [
        {
          "support_id": "SUP-A12",
          "type": "bounded_synthesis",
          "source_id": "EVR-TL-001",
          "role": "preliminary_conclusion"
        }
      ],
      "conditions": [],
      "contradictions": [],
      "operation": null
    }
  ],
  "unresolved": [
    "official_parcel_location",
    "exhaustive_normative_validity",
    "official_operational_formulas",
    "complete_use_and_building_requirements",
    "professional_review",
    "authority_validation",
    "annex_ii_original"
  ],
  "issues": [
    {
      "code": "LATER_NORMATIVE_CONTRADICTION",
      "severity": "S4",
      "affects": [
        "A7",
        "A9",
        "A12"
      ],
      "detail": "Debe reabrirse vigencia y aplicabilidad."
    }
  ],
  "forbidden_closure": true,
  "human_output": "Conclusión reabierta por contradicción normativa — V1\nUna disposición posterior contradictoria obliga a revisar vigencia, aplicabilidad y cálculos dependientes.",
  "epistemic_records": [
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A7",
      "claim": {
        "claim_id": "A7",
        "content": "Los límites publicados son FOS 0,6; FOT 1,2; CAS 0,2",
        "cognitive_type": "data",
        "epistemic_state": "conflict",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A7",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T11:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A7",
          "type": "official_document_fragment",
          "source_id": "SRC-001",
          "fragment_id": "ORD-5368-ART-2",
          "role": "normative_limits",
          "integrity": "verified_against_snapshot"
        }
      ],
      "dependencies": [
        {
          "dependency_id": "DEP-A7-1",
          "claim_id": "SRC-001",
          "required_state": "supported",
          "critical": false
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [
          {
            "id": "LATER_NORMATIVE_CONTRADICTION",
            "state": "open"
          }
        ],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 2,
        "revision_of": "ER-EVR-TL-001-A7",
        "supersedes": "ER-EVR-TL-001-A7@1",
        "current": true,
        "change_reason": "Apareció una ordenanza posterior contradictoria en la simulación."
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A9",
      "claim": {
        "claim_id": "A9",
        "content": "Los valores calculados satisfacen los límites localizados",
        "cognitive_type": "inference",
        "epistemic_state": "unverified",
        "domain": "normative_project",
        "conditions": [],
        "operation": {
          "kind": "deterministic_calculation_or_comparison"
        }
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A9",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T11:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A9",
          "type": "calculation_comparison",
          "source_id": "CALC-EVR-TL-001",
          "role": "limit_comparison"
        }
      ],
      "dependencies": [
        {
          "dependency_id": "DEP-A9-1",
          "claim_id": "A6",
          "required_state": "supported",
          "critical": true
        },
        {
          "dependency_id": "DEP-A9-2",
          "claim_id": "A7",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A9-3",
          "claim_id": "A8",
          "required_state": "supported",
          "critical": false
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 2,
        "revision_of": "ER-EVR-TL-001-A9",
        "supersedes": "ER-EVR-TL-001-A9@1",
        "current": true,
        "change_reason": "Apareció una ordenanza posterior contradictoria en la simulación."
      }
    },
    {
      "schema_version": "1.0",
      "record_id": "ER-EVR-TL-001-A12",
      "claim": {
        "claim_id": "A12",
        "content": "Puede declararse compatibilidad preliminar condicionada",
        "cognitive_type": "understanding",
        "epistemic_state": "unverified",
        "domain": "normative_project",
        "conditions": [],
        "operation": null
      },
      "scope": {
        "organism_id": "ORG-SYNTHETIC-001",
        "situation_id": "SIT-TL-001",
        "module": "pro_estudio",
        "jurisdiction": {
          "country": "Argentina",
          "province": "Buenos Aires",
          "municipality": "Trenque Lauquen"
        },
        "spatial_scope": {
          "cadastral_reference": "Synthetic lot asserted within Chacra 221 fraction",
          "location_verified": false,
          "inside_regulated_fraction": null,
          "certificate_ref": null
        },
        "temporal_scope": {
          "documentary_cutoff": "2026-08-17"
        },
        "project_version": "1.0",
        "coverage": "selected_R3_indicators_only"
      },
      "origin": {
        "event_id": "EV-EVR-TL-001-A12",
        "agent_type": "software_agent",
        "agent_id": "comprender_ai_vr1_runtime",
        "specialty": "pro_estudio",
        "method": "closed_corpus_deterministic_analysis",
        "generated_at": "2026-09-06T11:00:00.000Z"
      },
      "support": [
        {
          "support_id": "SUP-A12",
          "type": "bounded_synthesis",
          "source_id": "EVR-TL-001",
          "role": "preliminary_conclusion"
        }
      ],
      "dependencies": [
        {
          "dependency_id": "DEP-A12-1",
          "claim_id": "A5",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A12-2",
          "claim_id": "A7",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A12-3",
          "claim_id": "A8",
          "required_state": "supported",
          "critical": false
        },
        {
          "dependency_id": "DEP-A12-4",
          "claim_id": "EXPLICIT-LIMITS",
          "required_state": "supported",
          "critical": false
        }
      ],
      "limits": {
        "uncertainties": [
          {
            "id": "UNC-1",
            "type": "official_parcel_location",
            "description": "official_parcel_location",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-2",
            "type": "exhaustive_normative_validity",
            "description": "exhaustive_normative_validity",
            "impact": "critical",
            "state": "unresolved"
          },
          {
            "id": "UNC-3",
            "type": "official_operational_formulas",
            "description": "official_operational_formulas",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-4",
            "type": "complete_use_and_building_requirements",
            "description": "complete_use_and_building_requirements",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-5",
            "type": "professional_review",
            "description": "professional_review",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-6",
            "type": "authority_validation",
            "description": "authority_validation",
            "impact": "relevant",
            "state": "unresolved"
          },
          {
            "id": "UNC-7",
            "type": "annex_ii_original",
            "description": "annex_ii_original",
            "impact": "relevant",
            "state": "unresolved"
          }
        ],
        "contradictions": [],
        "exclusions": [
          "optional_setbacks",
          "services",
          "parking",
          "accessibility",
          "fire_safety",
          "structural_requirements",
          "complete_use_table",
          "administrative_documents"
        ]
      },
      "verification": {
        "verification_level": "V1",
        "reasoning_level": "R1",
        "traceability_level": "T2",
        "maximum_authorized_conclusion": {
          "label": "preliminary_conditional_compatibility"
        },
        "professional_review": {
          "performed": false,
          "actor_id": null,
          "artifact_ref": null
        },
        "authority_validation": {
          "performed": false,
          "actor_id": null,
          "act_ref": null
        }
      },
      "revision": {
        "version": 2,
        "revision_of": "ER-EVR-TL-001-A12",
        "supersedes": "ER-EVR-TL-001-A12@1",
        "current": true,
        "change_reason": "Apareció una ordenanza posterior contradictoria en la simulación."
      }
    }
  ],
  "provenance": {
    "runtime": "comprender-vr1-evr-tl-001@2.0.0",
    "deterministic": true,
    "network_used": false,
    "input_sha256": "31b4de9e5fecc0423c96fcd972c1aa0a3552aa9142cb6951bf1d0fb30496f574"
  },
  "validation": {
    "ok": true,
    "errors": []
  }
};
