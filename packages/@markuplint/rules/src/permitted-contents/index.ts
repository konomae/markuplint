import { Element, Result, createRule } from '@markuplint/ml-core';
import { PermittedStructuresSchema } from '@markuplint/ml-spec';
import htmlSpec from './html-spec';
import specToRegExp from './permitted-content.spec-to-regexp';
import unfoldContentModelsToTags from './unfold-content-models-to-tags';

type TagRule = PermittedStructuresSchema;

export default createRule<boolean, TagRule[]>({
	name: 'permitted-contents',
	defaultValue: true,
	defaultOptions: [],
	async verify(document, messages) {
		const reports: Result[] = [];
		await document.walkOn('Element', async node => {
			if (!node.rule.value) {
				return;
			}

			const nodes = node.getChildElementsAndTextNodeWithoutWhitespaces();
			const spec = htmlSpec(node.nodeName);

			if (spec) {
				let matched = false;
				if (spec.conditional) {
					for (const conditional of spec.conditional) {
						matched =
							('hasAttr' in conditional.condition && node.hasAttribute(conditional.condition.hasAttr)) ||
							('parent' in conditional.condition &&
								!!node.parentNode &&
								node.parentNode.type === 'Element' &&
								node.parentNode.matches(conditional.condition.parent));
						// console.log({ ...conditional, matched });
						if (matched) {
							const parentExp = getRegExpFromParentNode(node);
							const exp = specToRegExp(conditional.contents, parentExp);
							const conditionalResult = match(exp, nodes);
							if (!conditionalResult) {
								reports.push({
									severity: node.rule.severity,
									message: messages(`Invalid content in "${node.nodeName}" element on the HTML spec`),
									line: node.startLine,
									col: node.startCol,
									raw: node.raw,
								});
								break;
							}
						}
					}
				}

				if (!matched) {
					const exp = getRegExpFromNode(node);
					const specResult = match(exp, nodes);

					if (!specResult) {
						reports.push({
							severity: node.rule.severity,
							message: messages(`Invalid content in "${node.nodeName}" element on the HTML spec`),
							line: node.startLine,
							col: node.startCol,
							raw: node.raw,
						});
					}
				}
			}

			for (const rule of node.rule.option) {
				if (rule.tag.toLowerCase() !== node.nodeName.toLowerCase()) {
					continue;
				}

				const parentExp = getRegExpFromParentNode(node);
				const exp = specToRegExp(rule.contents, parentExp);
				const r = match(exp, nodes);

				if (!r) {
					reports.push({
						severity: node.rule.severity,
						message: messages(`Invalid content in "${node.nodeName}" element on rule settings`),
						line: node.startLine,
						col: node.startCol,
						raw: node.raw,
					});
					return;
				}
			}
		});
		return reports;
	},
});

type TargetNodes = ReturnType<Element<boolean, TagRule[]>['getChildElementsAndTextNodeWithoutWhitespaces']>;

function normalization(nodes: TargetNodes) {
	return nodes.map(node => `<${node.type === 'Element' ? node.nodeName : '#text'}>`).join('');
}

type El = {
	parentNode: El | null;
	nodeName: string;
};

function getRegExpFromNode(node: El) {
	// console.log({ n: node.nodeName });
	const parentExp = node.parentNode ? getRegExpFromNode(node.parentNode) : null;
	const spec = htmlSpec(node.nodeName);
	const contentRule = spec ? spec.contents : true;
	const exp = specToRegExp(contentRule, parentExp);
	return exp;
}

function getRegExpFromParentNode(node: El) {
	// console.log({ p: node.nodeName });
	const parentExp = node.parentNode ? getRegExpFromNode(node.parentNode) : null;
	return parentExp;
}

function match(exp: RegExp, nodes: TargetNodes) {
	const target = normalization(nodes);
	const result = exp.exec(target);
	if (!result) {
		return false;
	}
	const capGroups = result.groups;
	// console.log({ exp, target, capGroups });
	if (capGroups) {
		for (const groupName of Object.keys(capGroups)) {
			const matched = capGroups[groupName];
			if (!matched) {
				continue;
			}
			let targetsMaybeIncludesNotAllowedDescendants = Array.from(
				new Set(matched.split(/><|<|>/g).filter(_ => _)),
			);
			const [type, ..._selector] = groupName.split(/(?<=[a-z0-9])_/gi);
			const contents: Set<string> = new Set();
			const inTransparent = _selector.includes('__InTRANSPARENT')
				? capGroups['TRANSPARENT']
					? capGroups['TRANSPARENT'].split(/><|<|>/g).filter(_ => _)
					: null
				: null;
			_selector.forEach(content => {
				if (content[0] === '_') {
					unfoldContentModelsToTags(content.replace('_', '#')).forEach(tag => contents.add(tag));
					return;
				}
				contents.add(content);
			});
			const selectors = Array.from(contents);
			targetsMaybeIncludesNotAllowedDescendants = targetsMaybeIncludesNotAllowedDescendants.filter(content =>
				inTransparent ? inTransparent.includes(content) : true,
			);
			// console.log({
			// 	groupName,
			// 	matched,
			// 	_selector,
			// 	type,
			// 	selectors,
			// 	inTransparent,
			// 	targetsMaybeIncludesNotAllowedDescendants,
			// });
			switch (type) {
				case 'NAD': {
					for (const node of nodes) {
						for (const target of targetsMaybeIncludesNotAllowedDescendants) {
							if (node.type === 'Text') {
								if (selectors.includes('#text')) {
									return false;
								}
								continue;
							}
							if (node.nodeName.toLowerCase() !== target.toLowerCase()) {
								continue;
							}
							for (const selector of selectors) {
								// console.log({ selector, target });

								// Self
								if (node.matches(selector)) {
									return false;
								}

								// Descendants
								const nodeList = node.querySelectorAll(selector);
								if (nodeList.length) {
									return false;
								}
							}
						}
					}
					break;
				}
			}
		}
	}
	return !!result;
}
