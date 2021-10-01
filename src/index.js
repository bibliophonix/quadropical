import * as d3 from "d3";
import { complex, add, subtract, multiply, chain, sqrt, unit, sin, cos, to, tan, atan } from "mathjs";
import { TopicModeler } from "topical";
import defaultStopwords from "./stopwords.js";
import saveAs           from "./saveas.js";


// GLOBALS
const width  = 800,
      height = 700,
      margin = {top: 0, bottom: 0, left: 0, right: 0},
      xScale = d3.scaleLinear().range([margin.left, width - margin.right]),
      yScale = d3.scaleLinear().range([height - margin.bottom, margin.top]),
      radius = d3.scaleSqrt().range([2, 25]),
      color  = d3.scaleOrdinal(d3.schemeCategory10),
      white  = [255, 255, 255],
      fingerprintIntensity = d3.scaleLinear().range([0.33, 1.0]),
      formatTimestamp      = d3.timeFormat("%Y%m%dT%H%M%S%L"),
      formatCoord          = d3.format(".2f"),
      svg = d3.select("svg").attr("width", width).attr("height", height);


let data, columns, selectedColumns, idColumn, labelColumn, networkSource, networkDestination,
      stopwords = defaultStopwords,
      customStopwords = [],
      removedDefaultStopwords = [],
      modeler,
      topicLabels,
      topicTopWords = [],
      network = {},
      synonyms = {},
      annotationGroup = svg.append("g").attr("class", "annotations"),
      origin, firstCornerAngle, secondCornerAngle, thirdCornerAngle, fourthCornerAngle;


const topicCountLabels = {
  "3":  "Triopical",
  "4":  "Quadropical",
  "5":  "Quintopical",
  "6":  "Hexopical",
  "7":  "Septopical",
  "8":  "Octopical",
  "9":  "Nonopical",
  "10": "Decopical"
}

function loadCsv(event) {
  let fileUpload = event.target;
  if ("files" in fileUpload) {
    const file = fileUpload.files.item(0);
    d3.select("#current-file span").text(file.name);
    const reader = new FileReader();
    reader.addEventListener("loadend", event => {
      if (file.name.endsWith(".csv"))
        parseAndShowCsvHeaders(event.srcElement.result);
      else
        loadSessionFile(event.srcElement.result);
    });
    reader.readAsText(file);
  }
}


function loadSessionFile(session) {
  session = JSON.parse(session);

  data                    = session.data;
  columns                 = session.columns;
  selectedColumns         = session.selectedColumns;
  idColumn                = session.idColumn;
  labelColumn             = session.labelColumn;
  networkSource           = session.networkSource;
  networkDestination      = session.networkDestination;
  network                 = session.network;
  stopwords               = session.stopwords;
  customStopwords         = session.customStopwords;
  removedDefaultStopwords = session.removedDefaultStopwords;
  synonyms                = session.synonyms;
  modeler                 = TopicModeler.loadFromPriorModel(session.modeler);
  topicTopWords           = session.topicTopWords;
  topicLabels             = session.topicLabels;

  loadStopwords(true);
  displaySynonyms();
  displayColumns(session.columns, session.selectedColumns);
  updatePage();
  showTopics();
}


function parseAndShowCsvHeaders(contents) {
  data = d3.csvParse(contents);
  columns = data.columns;
  loadStopwords(true);
  displayColumns(columns);
  showTopics();
}


function displayColumns(columns, selectedColumns) {
  d3.select("#current-file").style("display", "block");
  d3.select("#download").style("display", "block");
  d3.select("#upload").style("display", "none");
  d3.select("#data-preparation").style("display", "block");


  let columnRows = d3.select("#select-columns table tbody")
        .selectAll("tr")
        .data(columns)
      .enter()
        .append("tr");

  columnRows.append("th").attr("class", "column").text(d => d);
  columnRows.append("td").append("input")
        .attr("type", "checkbox")
        .attr("name", "columns[]")
        .attr("value", d => d);
  columnRows.append("td").append("label").append("input")
        .attr("type", "radio")
        .attr("name", "identifier")
        .attr("value", d => d);
  columnRows.append("td").append("label").append("input")
        .attr("type", "radio")
        .attr("name", "label")
        .attr("value", d => d);
  columnRows.append("td").append("label").append("input")
        .attr("type", "radio")
        .attr("name", "network_source")
        .attr("value", d => d);
  columnRows.append("td").append("label").append("input")
        .attr("type", "radio")
        .attr("name", "network_destination")
        .attr("value", d => d);

  if (selectedColumns !== undefined) {
    columnRows.selectAll("input[name='columns[]']").property("checked", input => selectedColumns.includes(input));
    columnRows.selectAll("input[name='identifier'][value='" + idColumn + "']").property("checked", true);
    columnRows.selectAll("input[name='label'][value='" + labelColumn + "']").property("checked", true);
    columnRows.selectAll("input[name='network_source'][value='" + networkSource + "']").property("checked", true);
    columnRows.selectAll("input[name='network_destination'][value='" + networkDestination + "']").property("checked", true);
  }
}


function reprocess(event) {
  loadStopwords(false);
  runModeling();
  showTopics();
  event.preventDefault();
}


function showTopics() {
  document.querySelector("#top-terms>.accordion").classList.toggle("active");
  let panel = document.querySelector("#current-topics")
  panel.style.maxHeight = panel.scrollHeight + "px";
}


function selectColumns(event) {
  runModeling();
  event.preventDefault();
}


function runModeling() {
  selectedColumns    = Array.from(document.querySelectorAll("input[name='columns[]']:checked")).map(checkbox => checkbox.value);
  idColumn           = document.querySelector("input[name='identifier']:checked").value;
  labelColumn        = document.querySelector("input[name='label']:checked").value;
  networkSource      = document.querySelector("input[name='network_source']:checked").value;
  networkDestination = document.querySelector("input[name='network_destination']:checked").value;
  let documents = data.map(csvRow => {
    let docId   = csvRow[idColumn];
    let docDate = csvRow["Pub Year"];
    return selectedColumns.reduce((docString, column) => docString += `${csvRow[column]} `, `${docId}\t${docDate}\t`);
  });

  if (networkSource != "none" && networkDestination != "none") {
    // Set up a convenience Hash for tracking network links between docs.
    network = data.reduce((result, doc) => ({...result, [doc[networkDestination]] : new Array()}), {});
    data.forEach(doc => {
      doc[networkSource].split("; ").forEach(source => {
        if (network.hasOwnProperty(source))
          network[source].push(doc[networkDestination]);
      });
    });
  }

  initTopicModeler(documents);
  addExtraData();
  updatePage();
}


function updatePage() {
  clearTopics();
  clearQuadrants();
  displayCurrentTopics();
  updateTitle();
}


function initTopicModeler(documents) {
  modeler = new TopicModeler(stopwords, documents);
  modeler.synonyms = synonyms;
  modeler.numTopics = parseInt(document.getElementById("num-topics").value);
  modeler.processCorpus();
  modeler.requestedSweeps = 100;
  sweep();
}


function addExtraData() {
  modeler.documents.forEach(doc => {
    doc.label = data.find(csvRow => csvRow[idColumn] == doc.id)[labelColumn];
    doc.links = network[doc.id];
  });
}


function clearTopics() {
  // TODO: make these consistent by removing the empty list containers
  d3.selectAll("#top-terms-by-topic .topic").remove();
  d3.selectAll("#term-distribution ul li").remove();
  d3.selectAll("#corpus-topics ol li").remove();
  d3.select("svg g.container").remove();
  d3.selectAll(".document").remove();
  document.getElementById("show-networks").checked = false;
}


function clearQuadrants() {
  d3.selectAll(".axis").remove();
  d3.selectAll(".quadrant-axis").remove();
  d3.selectAll(".quadrant-label").remove();
  d3.selectAll(".slice-cut").remove();
  d3.selectAll(".slice-label").remove();
  d3.selectAll(".score-line").remove();
  resetNodeColors();
}


function resweep() {
  clearTopics();
  modeler.requestedSweeps = modeler.completeSweeps + 50;
  sweep();
  clearQuadrants();
  displayCurrentTopics();
}


function sweep() {

  let start = new Date();
  while (modeler.completeSweeps < modeler.requestedSweeps) {
    modeler.sweep();
    document.getElementById("sweeps").innerHTML = modeler.completeSweeps;
  }
  let finish = new Date();
  document.getElementById("time").innerHTML = (finish - start) + "ms";

  // Pull out the top words from the topics
  topicTopWords = [];
  for (let topic = 0; topic < modeler.numTopics; topic++)
    topicTopWords[topic] = modeler.topNWords(modeler.topicWordCounts[topic], 20);

  topicLabels = topicTopWords.map(topWords => topWords.split(" ")[0]);

  // For each rotation angle, find its complex number representation on the unit circle.
  let sliceAngle = 360 / modeler.numTopics;
  let rotationAngles = [...Array(modeler.numTopics).keys()].map(num => (num * sliceAngle) + (sliceAngle / 2));
  let rotationCoefficients = rotationAngles.map(angle => complex( cos(unit(angle, "deg")), sin(unit(angle, "deg")) ));

  // Given the rotation coefficients representing the unit circle angle positions, multiply them by the corresponding
  // topic scores in each document, then  add them all together to determine the final coordinates.
  modeler.documents.forEach((doc, j) => {
    // Start by finding only the topics that were scored greater than 0 for the current document while
    // being sure to maintain the score index so it lines up with rotation angle indices.
    doc.highestScore = {score: -1, topicIndex: -1};
    let scoredTopics = doc.topicCounts.reduce((scoredTopics, topicScore, i) => {
      if (topicScore > 0) {
        scoredTopics[i] = topicScore;
        if (topicScore > doc.highestScore.score) doc.highestScore = {score: topicScore, topicIndex: i};
      }
      return scoredTopics;
    }, {});

    // For each scored topic for the current document, rotate it by its corresponding rotation coefficient
    // and index it by its topic index...
    doc.scoredTopicCoordinates = Object.keys(scoredTopics).reduce((map, topicIndex) => {
      map[topicIndex] = multiply(rotationCoefficients[topicIndex], complex(scoredTopics[topicIndex], 0));
      return map;
    }, {});

    // Finally compute the final coordinates by summing all the scored topics.
    doc.coordinates = Object.values(doc.scoredTopicCoordinates).reduce((previousValue, currentValue) => {
      return add(previousValue, currentValue);
    }, complex(0, 0));
  });
}


function displayCurrentTopics() {
  d3.select("#processing-details").style("display", "block");
  d3.select("#synonyms").style("display", "block");
  d3.select("#stopwords").style("display", "block");
  d3.select("#sweeps").text(modeler.completeSweeps);
  document.querySelector("select#num-topics").value = modeler.numTopics;

  d3.select("#corpus-topics").style("display", "block");
  d3.select("#corpus-topics ol")
      .selectAll(".topic")
      .data(topicTopWords)
    .enter()
      .append("li")
      .attr("class", "topic")
      .text(d => d.split(" ").slice(0, 4).join(" "));

  // For the top topic words, how many topics do they appear in?
  let wordCounts = {};
  topicTopWords.forEach(wordList => {
    wordList.split(" ").forEach(word => {
      if (!wordCounts[word]) wordCounts[word] = {count: 0, word: word};
      wordCounts[word].count += 1
    });
  });

  d3.select("#top-terms").style("display", "block");
  d3.select("#term-distribution ul")
      .selectAll(".term")
      .data(Object.values(wordCounts).sort((a, b) => d3.descending(a.count, b.count)))
    .enter()
      .append("li")
      .attr("class", "term")
      .text(d => d.word + ": " + d.count + " topic" + (d.count > 1 ? "s" : ""))

  let topicTerms = d3.select("#top-terms-by-topic")
      .selectAll(".topic")
      .data(topicTopWords)
    .enter()
      .append("div")
      .attr("class", "topic");

  topicTerms.append("h3").text((d, i) => "Topic " + (i + 1));
  topicTerms.append("ol")
      .selectAll(".feature")
      .data(d => d.split(" "))
    .enter()
      .append("li")
      .attr("class", "feature")
      .text(d => d)
      .on("click", toggleCustomStopword);


  xScale.domain(d3.extent(modeler.documents, d => d.coordinates.re));
  yScale.domain(d3.extent(modeler.documents, d => d.coordinates.im));
  radius.domain([0, d3.max(Object.values(network).map(citations => citations.length))]);
  fingerprintIntensity.domain([0, d3.max(modeler.documents, d => d.highestScore.score)]);

  const dotgroups = svg.append("g").attr("class", "container")
      .selectAll(".dot")
      .data(modeler.documents)
    .join("g")
      .attr("class", "dot")
      .attr("transform", d => `translate(${xScale(d.coordinates.re)}, ${yScale(d.coordinates.im)})`);

  dotgroups.append("circle")
    .attr("class", "node")
    .attr("fill", d => color(d.highestScore.topicIndex))
    .attr("opacity", 0.5)
    .attr("r", d => radius(network[d.id].length))
    .on("click", (event, d) => { showFingerprint(d); displaySelectedNode(d); });

  origin = {x: xScale(0), y: yScale(0)};
  let sliceAngles = [...Array(modeler.numTopics).keys()].map(num => num * (360 / modeler.numTopics));
  addSliceLines(sliceAngles, annotationGroup);

  d3.select("#document-list").style("display", "block");
  let documents = d3.select("#document-list")
      .selectAll(".document")
      .data(modeler.documents)
    .enter()
      .append("div")
      .attr("class", "document");

  documents.append("h3").text(d => `${d.id} (${d.date})`);
  documents.append("p").text(d => d.originalText.length > 128 ? d.originalText.slice(0, 128) + "..." : d.originalText);
  displayArticleTopicDetails();

  d3.selectAll("svg").on("click", (e, d) => {
    switch(e.target.nodeName) {
      case "circle":
        break;
      default:
        resetNodeColors();
    }
  });
}


function displaySelectedNode(d) {
  d3.select("#selected-node").style("display", "block");
  d3.select("#selected-node .id span").text(d.id);
  d3.select("#selected-node .label span").text(d.label);
  d3.select("#selected-node .scores ol")
      .selectAll(".score")
      .data(d.topicCounts)
    .enter()
      .append("li")
      .attr("class", "score")
      .style("color", (d, i) => color(i))
      .text(d => d);
}


function showFingerprint(d) {
  resetNodeColors();

  // Gray out all other dots
  d3.selectAll(".node")
    .filter(node => node.id != d.id)
    .attr("fill", "lightgrey")
    .attr("opacity", 0.33);

  // Draw a color coded line to each score
  let topicPoints = Object.keys(d.scoredTopicCoordinates).map(topicIndex => {
    let score = d.scoredTopicCoordinates[topicIndex];
    return {x: xScale(score.re), y: yScale(score.im), topicIndex: topicIndex, rawScore: d.topicCounts[topicIndex]};
  }).sort((a, b) => (a.rawScore > b.rawScore) ? 1 : ((b.rawScore > a.rawScore) ? -1 : 0));

  topicPoints.forEach(topicPoint => {
    svg.append("line")
      .attr("class", "score-line")
      .attr("x1", xScale(d.coordinates.re))
      .attr("y1", yScale(d.coordinates.im))
      .attr("x2", topicPoint.x)
      .attr("y2", topicPoint.y)
      .attr("stroke", color(topicPoint.topicIndex))
      .attr("opacity", fingerprintIntensity(topicPoint.rawScore));

    svg.append("line")
      .attr("class", "score-line")
      .attr("x1", origin.x)
      .attr("y1", origin.y)
      .attr("x2", topicPoint.x)
      .attr("y2", topicPoint.y)
      .attr("stroke", color(topicPoint.topicIndex))
      .attr("opacity", fingerprintIntensity(topicPoint.rawScore));
  });

  topicPoints.forEach(topicPoint => {
    let nodePoint = {x: xScale(d.coordinates.re), y: yScale(d.coordinates.im)};
    let trianglePoints = [origin, topicPoint, nodePoint];
    let trianglePathString = trianglePoints.reduce((pathString, point, i, arr) => {
      pathString += (i == 0) ? "M" : "L";
      pathString += point.x + " " + point.y + " ";
      pathString += (i == arr.length - 1) ? "Z" : "";
      return pathString;
    }, "");

    svg.append("path")
      .attr("class", "topical-fingerprint")
      .attr("d", trianglePathString)
      .attr("fill", fingerprintTopicColor(topicPoint))
      .attr("opacity", 0.9);
  });
}


/**
  Given a color, blend it with the color white by a percentage inverse to to the current topic's score.
  Algorithm:

  blendedcolor = inputcolorRGBvalue + (whiteRGBvalue - inputcolorRGBvalue) * percentage
*/
function fingerprintTopicColor(topicPoint) {
  let lightness  = 1.0 - fingerprintIntensity(topicPoint.rawScore);
  let topicColor = d3.rgb(color(topicPoint.topicIndex));
  let fadedColor = chain(white)
                    .subtract([topicColor.r, topicColor.g, topicColor.b])
                    .multiply(lightness)
                    .add([topicColor.r, topicColor.g, topicColor.b])
                    .done();

  return d3.rgb(...fadedColor);
}


function resetNodeColors() {
  d3.selectAll(".score-line").remove();
  d3.selectAll(".topical-fingerprint").remove();
  d3.selectAll(".node").attr("fill", d => color(d.highestScore.topicIndex));
  d3.select("#selected-node").style("display", "none");
  d3.selectAll("#selected-node .score").remove();
}


function addSliceLines(angles, container) {
  // First, determine the angles from the current origin to the bounding rectangle's corners (sohcahTOA)

  let opposite1 = origin.y;
  let adjacent1 = width - origin.x;
  let tangent1  = opposite1 / adjacent1;
  firstCornerAngle = to(unit(atan(tangent1), 'rad'), 'deg').toNumber();

  let opposite2 = origin.y;
  let adjacent2 = origin.x;
  let tangent2  = opposite2 / adjacent2;
  secondCornerAngle = 90 + to(unit(atan(tangent2), 'rad'), 'deg').toNumber();

  let opposite3 = height - origin.y;
  let adjacent3 = origin.x;
  let tangent3  = opposite3 / adjacent3;
  thirdCornerAngle = 180 + to(unit(atan(tangent3), 'rad'), 'deg').toNumber();

  let opposite4 = height - origin.y;
  let adjacent4 = width  - origin.x;
  let tangent4  = opposite4 / adjacent4;
  fourthCornerAngle = 270 + to(unit(atan(tangent4), 'rad'), 'deg').toNumber();

  // Then process each angle

  angles.forEach((angle, i) => {
    // Which octile am I in? Intercept with the right, top, left or bottom edge?
    let x, y, octile;
    let quantileTangent = tan(unit(angle, 'deg'));

    if (angle <= firstCornerAngle) {
      // Octile 1
      octile = 1;
      x = width - origin.x;
      y = quantileTangent * x * -1;
    } else if (angle <= 90) {
      // Octile 2
      octile = 2;
      y = -origin.y;
      x = (y / quantileTangent) * -1;
    } else if (angle <= secondCornerAngle) {
      // Octile 3
      octile = 3;
      y = -origin.y;
      x = (y / quantileTangent) * -1;
    } else if (angle <= 180) {
      // Octile 4
      octile = 4;
      x = -origin.x;
      y = quantileTangent * x * -1;
    } else if (angle <= thirdCornerAngle) {
      // Octile 5
      octile = 5;
      x = -origin.x;
      y = quantileTangent * x * -1;
    } else if (angle <= 270) {
      // Octile 6
      octile = 6;
      y = width - origin.y;
      x = (y / quantileTangent) * -1;
    } else if (angle <= fourthCornerAngle) {
      // Octile 7
      octile = 7;
      y = width - origin.y;
      x = (y / quantileTangent) * -1;
    } else {
      // Octile 8
      octile = 8;
      x = width - origin.x;
      y = quantileTangent * x * -1;
    }

    // Offset point to by the origin amounts, and...
    let point2 = {x: x + origin.x, y: y + origin.y};

    // Reset point boundaries to the rectangular bounding box as needed
    if (octile == 1 || octile == 8)
      point2.x = width - margin.right;
    else if (octile == 2 || octile == 3)
      point2.y = margin.top;
    else if (octile == 4 || octile == 5)
      point2.x = margin.left;
    else if (octile == 6 || octile == 7)
      point2.y = height - margin.bottom;

    container.append("g")
      .append("line")
      .attr("class", "slice-cut")
      .attr("id", "angle-" + angle)
      .attr("x1", origin.x)
      .attr("y1", origin.y)
      .attr("x2", point2.x)
      .attr("y2", point2.y);

    let labelAngle = angle + (angles[1] / 2);
    let labelPoint = {
      x: (origin.y * 0.8) * cos(unit(-labelAngle, "deg")) + origin.x,
      y: (origin.y * 0.8) * sin(unit(-labelAngle, "deg")) + origin.y
    }

    container.append("g")
      .attr("transform", d => `translate(${labelPoint.x - 40}, ${labelPoint.y})`)
      .attr("class", "slice-label")
      .append("text")
      .text("T" + (i + 1) + ": " + topicLabels[i])
      .attr("fill", color(i));
  });
}


function displayArticleTopicDetails() {
  let documents = d3.selectAll(".document");

  documents.append("p")
      .attr("class", "document-topic-scores")
      .text(d => {
        return topicTopWords.map((item, number) => `${topicLabels[number]}: ${d.topicCounts[number]}`).join("; ");
      });

  documents.append("p").attr("class", "document-topic-coords").text(d => {
    return "Real: " + formatCoord(d.coordinates.re) + ", Imaginary: " + formatCoord(d.coordinates.im);
  });
}


function toggleNavigation(event) {
  toggleMainDisplay(event.target.innerText);
  event.preventDefault();
}


function toggleMainDisplay(displaySection) {
  document.querySelectorAll("#main #nav ul li a").forEach(navItem => {
    if (navItem.innerText == displaySection)
      navItem.classList.add("selected");
    else
      navItem.classList.remove("selected");
  });

  if (displaySection == "Manage") {
    d3.select("#manage").style("display", "block");
    d3.select("#graph").style("display", "none");
  } else {
    d3.select("#graph").style("display", "block");
    d3.select("#manage").style("display", "none");
  }
}


function loadStopwords(firstLoad) {
  if (!firstLoad) {
    customStopwords = Array.from(document.querySelectorAll(".custom-stopword"))
         .map(nodeItem => nodeItem.innerText)
         .filter(unique);
    removedDefaultStopwords = Array.from(document.querySelectorAll(".removed-default-stopword"))
         .map(nodeItem => nodeItem.innerText)
         .filter(unique);
    stopwords = defaultStopwords.filter(word => !removedDefaultStopwords.includes(word))
         .concat(customStopwords)
         .sort()
         .filter(unique);
  }

  d3.select("#add-stopwords ol").remove();
  d3.select("#add-stopwords")
      .append("ol")
      .selectAll(".stopword")
      .data(customStopwords.concat(defaultStopwords).sort())
    .enter()
      .append("li")
      .attr("class", d => {
        let cls = ["stopword"];
        if (customStopwords.includes(d)) cls.push("custom-stopword");
        if (removedDefaultStopwords.includes(d)) cls.push("removed-default-stopword");
        return cls.join(" ");
      })
      .text(d => d)
      .on("click", toggleStopword);
}


function toggleCustomStopword(event) {
  // Set the class for ALL instances if the feature term exists in multiple topics.
  document.querySelectorAll("#top-terms-by-topic li").forEach(feature => {
    if (feature.innerText == event.target.innerText)
      feature.classList.toggle("custom-stopword");
  });
}


function toggleStopword(event) {
  if (event.target.classList.contains("custom-stopword")) {
    // stopwords = stopwords.filter((value, index, arr) => value != event.target.innerText);
    event.target.classList.remove("custom-stopword");
    event.target.classList.toggle("removed-custom-stopword");
  } else if (event.target.classList.contains("removed-default-stopword")) {
    event.target.classList.remove("removed-default-stopword");
  } else {
    event.target.classList.add("removed-default-stopword");
  }
}


function toggleNetworks(event) {
  resetNodeColors();
  if (event.target.checked) {

    let container = d3.select("svg g.container");
    modeler.documents.forEach(doc => {
      let sourceDoc = getDocumentById(doc.id);
      doc.links.map(link => getDocumentById(link))
          .filter(linkedDoc => linkedDoc !== undefined)
          .forEach(linkedDoc => {
            container.append("line")
              .style("stroke", color(doc.highestScore.topicIndex))
              .style("stroke-width", "1")
              .style("opacity", 0.2)
              .attr("class", "citing-line")
              .attr("x1", xScale(sourceDoc.coordinates.re))
              .attr("y1", yScale(sourceDoc.coordinates.im))
              .attr("x2", xScale(linkedDoc.coordinates.re))
              .attr("y2", yScale(linkedDoc.coordinates.im));
          });
    });
  } else {
    d3.selectAll(".citing-line").remove();
  }
}


function getDocumentById(id) {
  return modeler.documents.filter(doc => doc.id == id)[0];
}


function unique(value, index, self) {
  return self.indexOf(value) === index;
}


function addManualStopwords() {
  document.getElementById("manual-stopwords").value.split(/\s+/).forEach(word => {
    d3.select("#stopwords ol").append("li").attr("class", "stopword custom-stopword").text(word);
  });
  loadStopwords(false);
  document.getElementById("manual-stopwords").value = "";
  event.preventDefault();
}


function addManualSynonyms() {
  let newSynonyms = document.getElementById("manual-synonyms").value.split(/\s+/);
  let mainWord = newSynonyms.shift();
  newSynonyms.forEach(word => synonyms[word] = mainWord);
  displaySynonyms();
  document.getElementById("manual-synonyms").value = "";
  let panel = document.querySelector("#add-synonyms")
  panel.style.maxHeight = panel.scrollHeight + "px";
  event.preventDefault();
}


function displaySynonyms() {
  d3.selectAll(".mapped-synonym").remove();
  d3.select("#add-synonyms")
      .selectAll(".mapped-synonym")
      .data(Object.keys(synonyms).sort())
    .enter()
      .append("p")
      .attr("class", "mapped-synonym")
      .text(d => `${d}: ${synonyms[d]}`);
}


function download() {

  saveAs(
    new Blob([JSON.stringify({
      data: data,
      columns: columns,
      selectedColumns: selectedColumns,
      idColumn: idColumn,
      labelColumn: labelColumn,
      networkSource: networkSource,
      networkDestination: networkDestination,
      network: network,
      stopwords: stopwords,
      customStopwords: customStopwords,
      removedDefaultStopwords: removedDefaultStopwords,
      synonyms: synonyms,
      modeler: modeler,
      topicTopWords: topicTopWords,
      topicLabels: topicLabels
    })], {type: "application/json;charset=utf-8"}),
    "quadropical-session-" + formatTimestamp(new Date()) + ".json"
  );

  event.preventDefault();
}


function toggleAccordion() {
  this.classList.toggle("active");
  var panel = this.nextElementSibling;
  if (panel.style.maxHeight)
    panel.style.maxHeight = null;
  else
    panel.style.maxHeight = panel.scrollHeight + "px";
}


function updateTitle() {
  let numTopics = document.getElementById("num-topics").value;
  document.querySelector("#details>h1").textContent = topicCountLabels[numTopics];
}


// Handler when the DOM is fully loaded
const ready = () => {
  // EVENT WATCHERS
  document.getElementById("select-columns").addEventListener("submit", selectColumns);
  document.getElementById("reprocess").addEventListener("click", reprocess);
  document.getElementById("corpus-upload").addEventListener("change", loadCsv);
  document.getElementById("resweep").addEventListener("click", resweep);
  document.querySelector("#add-stopwords form").addEventListener("submit", addManualStopwords);
  document.querySelector("#add-synonyms form").addEventListener("submit", addManualSynonyms);
  document.querySelectorAll("#nav ul li a").forEach(navItem => navItem.addEventListener("click", toggleNavigation));
  document.getElementById("show-networks").addEventListener("change", toggleNetworks);
  document.getElementById("download-button").addEventListener("click", download);
  document.querySelectorAll(".accordion").forEach(sectionName => sectionName.addEventListener("click", toggleAccordion));
  document.getElementById("num-topics").addEventListener("change", updateTitle);
};

if (document.readyState === "complete" || (document.readyState !== "loading" && !document.documentElement.doScroll))
  ready();
else
  document.addEventListener("DOMContentLoaded", ready);
