"use strict";

import { Collection } from "immutable";

import { TargetLanguage } from "../TargetLanguage";
import { Type, UnionType, ClassType, matchTypeExhaustive, EnumType } from "../Type";
import { TypeGraph } from "../TypeGraph";
import { ConvenienceRenderer } from "../ConvenienceRenderer";
import { Namer, funPrefixNamer } from "../Naming";
import { legalizeCharacters, splitIntoWords, combineWords, firstUpperWordStyle, allUpperWordStyle } from "../Strings";
import { defined, assert, panic } from "../Support";
import { StringTypeMapping } from "../TypeBuilder";
import { descriptionTypeAttributeKind } from "../TypeAttributes";
import { Option } from "../RendererOptions";

export default class JSONSchemaTargetLanguage extends TargetLanguage {
    constructor() {
        super("JSON Schema", ["schema", "json-schema"], "schema");
    }

    protected getOptions(): Option<any>[] {
        return [];
    }

    protected get partialStringTypeMapping(): Partial<StringTypeMapping> {
        return { date: "date", time: "time", dateTime: "date-time" };
    }

    get supportsOptionalClassProperties(): boolean {
        return true;
    }

    protected get rendererClass(): new (
        targetLanguage: TargetLanguage,
        graph: TypeGraph,
        leadingComments: string[] | undefined,
        ...optionValues: any[]
    ) => ConvenienceRenderer {
        return JSONSchemaRenderer;
    }
}

const namingFunction = funPrefixNamer("namer", jsonNameStyle);

const legalizeName = legalizeCharacters(cp => cp >= 32 && cp < 128 && cp !== 0x2f /* slash */);

function jsonNameStyle(original: string): string {
    const words = splitIntoWords(original);
    return combineWords(
        words,
        legalizeName,
        firstUpperWordStyle,
        firstUpperWordStyle,
        allUpperWordStyle,
        allUpperWordStyle,
        "",
        _ => true
    );
}

type Schema = { [name: string]: any };

export class JSONSchemaRenderer extends ConvenienceRenderer {
    protected topLevelNameStyle(rawName: string): string {
        return jsonNameStyle(rawName);
    }

    protected makeNamedTypeNamer(): Namer {
        return namingFunction;
    }

    protected namerForClassProperty(): null {
        return null;
    }

    protected makeUnionMemberNamer(): null {
        return null;
    }

    protected makeEnumCaseNamer(): null {
        return null;
    }

    private nameForType = (t: Type): string => {
        return defined(this.names.get(this.nameForNamedType(t)));
    };

    private makeOneOf = (types: Collection<any, Type>): Schema => {
        const count = types.count();
        assert(count > 0, "Must have at least one type for oneOf");
        if (count === 1) {
            return this.schemaForType(defined(types.first()));
        }
        return { oneOf: types.map(this.schemaForType).toArray() };
    };

    private makeRef(t: Type): Schema {
        return { $ref: `#/definitions/${this.nameForType(t)}` };
    }

    private schemaForType = (t: Type): Schema => {
        const schema = matchTypeExhaustive<{ [name: string]: any }>(
            t,
            _noneType => {
                return panic("None type should have been replaced");
            },
            _anyType => ({}),
            _nullType => ({ type: "null" }),
            _boolType => ({ type: "boolean" }),
            _integerType => ({ type: "integer" }),
            _doubleType => ({ type: "number" }),
            _stringType => ({ type: "string" }),
            arrayType => ({ type: "array", items: this.schemaForType(arrayType.items) }),
            classType => this.makeRef(classType),
            mapType => ({ type: "object", additionalProperties: this.schemaForType(mapType.values) }),
            _objectType => {
                return panic("FIXME: support object types");
            },
            enumType => this.makeRef(enumType),
            unionType => {
                if (this.unionNeedsName(unionType)) {
                    return this.makeRef(unionType);
                } else {
                    return this.definitionForUnion(unionType);
                }
            },
            _dateType => ({ type: "string", format: "date" }),
            _timeType => ({ type: "string", format: "time" }),
            _dateTimeType => ({ type: "string", format: "date-time" })
        );
        const description = this.typeGraph.attributeStore.tryGet(descriptionTypeAttributeKind, t);
        if (description !== undefined) {
            schema.description = description.join("\n");
        }
        return schema;
    };

    private definitionForClass(c: ClassType, title: string): Schema {
        const properties: Schema = {};
        const required: string[] = [];
        c.properties.forEach((p, name) => {
            properties[name] = this.schemaForType(p.type);
            if (!p.isOptional) {
                required.push(name);
            }
        });
        return {
            type: "object",
            additionalProperties: false,
            properties,
            required: required.sort(),
            title
        };
    }

    private definitionForUnion(u: UnionType, title?: string): Schema {
        const oneOf = this.makeOneOf(u.sortedMembers);
        if (title !== undefined) {
            oneOf.title = title;
        }
        return oneOf;
    }

    private definitionForEnum(e: EnumType, title: string): Schema {
        return { type: "string", enum: e.cases.toArray(), title };
    }

    protected emitSourceStructure(): void {
        // FIXME: Find a better way to do multiple top-levels.  Maybe multiple files?
        const schema = this.makeOneOf(this.topLevels);
        const definitions: { [name: string]: Schema } = {};
        this.forEachClass("none", (c, name) => {
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForClass(c, title);
        });
        this.forEachUnion("none", (u, name) => {
            if (!this.unionNeedsName(u)) return;
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForUnion(u, title);
        });
        this.forEachEnum("none", (e, name) => {
            const title = defined(this.names.get(name));
            definitions[title] = this.definitionForEnum(e, title);
        });
        schema.definitions = definitions;

        this.emitMultiline(JSON.stringify(schema, undefined, "    "));
    }
}
