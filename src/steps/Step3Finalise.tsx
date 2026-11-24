import { DesignSheet } from '../components/DesignSheet';
import { Button, Facts, Heading, PanelBody, PanelFooter, TwoZone } from '../components/ui';
import { formatCount, formatLength } from '../domain/dimensions';
import { requestEditDesign, requestEditDimensions } from '../state/editActions';
import { gridSpec, useApp } from '../state/store';

export function Step3Finalise() {
  const designFinal = useApp((s) => s.designFinal);
  const unit = useApp((s) => s.dimensions.unit);
  const { finaliseDesign, goTo } = useApp.getState();
  const grid = gridSpec(useApp.getState());

  return (
    <TwoZone
      canvas={<DesignSheet />}
      panel={
        <>
          <PanelBody>
            {designFinal ? (
              <Heading title="Design and size are final">
                The knot map is made from this design. Editing it discards the knot map.
              </Heading>
            ) : (
              <Heading title="Is this design and size final?">
                The knot map is generated from exactly what you see here.
              </Heading>
            )}
            <Facts
              rows={[
                ['Width', formatLength(grid.widthIn, unit)],
                ['Height', formatLength(grid.heightIn, unit)],
                ['Knot grid', `${formatCount(grid.columns)} × ${formatCount(grid.rows)}`],
                ['Total knots', formatCount(grid.columns * grid.rows)],
              ]}
            />
          </PanelBody>
          <PanelFooter>
            {designFinal ? (
              <>
                <Button variant="primary" onClick={() => goTo(4)}>
                  Go to knot map
                </Button>
                <Button onClick={() => void requestEditDesign()}>Edit</Button>
              </>
            ) : (
              <>
                <Button variant="primary" onClick={finaliseDesign}>
                  Yes, generate knot map
                </Button>
                <Button onClick={() => goTo(2)}>Change design</Button>
                <Button onClick={() => void requestEditDimensions()}>Change dimensions</Button>
              </>
            )}
          </PanelFooter>
        </>
      }
    />
  );
}
